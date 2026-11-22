/**
 * GitLab REST API v4 的最小客户端（T44）：gitlab.com 和自建一样，只是地址不同。
 * - 只接受 http(s) 地址，不带账号密码；不跟随跳转（防止被引到别的主机）；每个请求 15 秒超时。
 * - 自建 GitLab 常在内网，所以不像模型接口那样禁止内网地址；连接只有企业超管 / 系统超管能配，
 *   返回的内容只取需要的字段，不把原始响应回显给用户。
 */

export class GitError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function cleanBaseUrl(raw: unknown): string | null {
  let s = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!s || s.length > 300) return null;
  // 只写了域名（如 git.example.com、gitlab.com）时补上 https://
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password || u.search || u.hash) return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export type GitLabUser = { username: string; name: string };
export type GitLabProject = { id: number; path_with_namespace: string; web_url: string; default_branch: string | null };
export type GitLabCommit = { id: string; short_id: string; title: string; message: string; author_name: string; created_at: string; web_url: string };
export type GitLabMR = { iid: number; title: string; description: string | null; state: string; source_branch: string; target_branch: string; web_url: string; author?: { username: string; name: string }; merged_at: string | null; updated_at: string; draft?: boolean; merge_commit_sha?: string | null };
export type GitLabTag = { name: string; commit: { id: string; created_at: string }; message: string | null };
export type GitLabBranch = { name: string; web_url: string; commit: { id: string; committed_date: string; author_name: string; title: string } };

export class GitLab {
  constructor(
    private baseUrl: string,
    private token: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/v4${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: { "PRIVATE-TOKEN": this.token, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
      });
    } catch {
      throw new GitError("连不上 GitLab：请检查地址，以及服务器能不能访问到它", 502);
    }
    if (res.status === 401) throw new GitError("访问令牌无效或已过期：请确认复制的是完整令牌（gitlab.com 一般以 glpat- 开头），勾选了 api 或 read_api，并且没有被浏览器自动填成别的密码", 400);
    if (res.status === 403) throw new GitError("访问令牌没有这个权限（只读令牌不能建分支、写评论）", 403);
    if (res.status === 404) throw new GitError("GitLab 上找不到（路径不对，或令牌看不到这个项目）", 404);
    if (!res.ok) throw new GitError(`GitLab 返回 ${res.status}`, 502);
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GitError("GitLab 返回的内容不对（地址是不是 GitLab 首页？）", 502);
    }
  }

  user() {
    return this.req<GitLabUser>("/user");
  }
  async version() {
    return this.req<{ version: string }>("/version").then((v) => v.version).catch(() => "");
  }
  project(pathOrId: string | number) {
    return this.req<GitLabProject>(`/projects/${encodeURIComponent(String(pathOrId))}`);
  }
  commits(id: number, params: { since?: string; ref?: string; all?: boolean; perPage?: number }) {
    const q = new URLSearchParams({ per_page: String(params.perPage ?? 100), ...(params.since ? { since: params.since } : {}), ...(params.ref ? { ref_name: params.ref } : {}), ...(params.all ? { all: "true" } : {}) });
    return this.req<GitLabCommit[]>(`/projects/${id}/repository/commits?${q}`);
  }
  mergeRequests(id: number, updatedAfter?: string) {
    const q = new URLSearchParams({ per_page: "100", order_by: "updated_at", scope: "all", ...(updatedAfter ? { updated_after: updatedAfter } : {}) });
    return this.req<GitLabMR[]>(`/projects/${id}/merge_requests?${q}`);
  }
  pipelines(id: number, sha: string) {
    return this.req<{ id: number; status: string }[]>(`/projects/${id}/pipelines?${new URLSearchParams({ sha, per_page: "20" })}`);
  }
  tags(id: number) {
    return this.req<GitLabTag[]>(`/projects/${id}/repository/tags?per_page=50&order_by=updated`);
  }
  branches(id: number, search?: string) {
    return this.req<GitLabBranch[]>(`/projects/${id}/repository/branches?per_page=100${search ? `&search=${encodeURIComponent(search)}` : ""}`);
  }
  compare(id: number, from: string, to: string) {
    return this.req<{ commits: GitLabCommit[] }>(`/projects/${id}/repository/compare?${new URLSearchParams({ from, to, straight: "false" })}`);
  }
  createBranch(id: number, branch: string, ref: string) {
    return this.req<GitLabBranch>(`/projects/${id}/repository/branches?${new URLSearchParams({ branch, ref })}`, { method: "POST" });
  }
  mrNote(id: number, iid: number, body: string) {
    return this.req<{ id: number }>(`/projects/${id}/merge_requests/${iid}/notes`, { method: "POST", body: JSON.stringify({ body }) });
  }
}

/** 分支名：feature/R1042-<英文或拼音外的 ASCII 片段>；GitLab 分支名不能有空格、~^:?*[\\ 等 */
export function branchNameFor(code: string, title: string, prefix = "feature") {
  const slug = title
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  return `${prefix}/${code}${slug ? `-${slug}` : ""}`;
}

export function validBranchName(name: string) {
  return /^[A-Za-z0-9._/-]{1,120}$/.test(name) && !name.includes("..") && !name.startsWith("/") && !name.endsWith("/") && !name.endsWith(".lock");
}
