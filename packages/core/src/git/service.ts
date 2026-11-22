import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@pm-collab/db/prisma";
import type { SessionUser } from "../auth";
import { can } from "../permissions";
import { canSeeProject, requirementVisible } from "../access";
import { result } from "../requirements/result";
import { ADMIN_ROLE } from "../shared/roles-shared";
import { enterpriseAdminOf } from "../shared/enterprise-admin";
import { enterpriseOfUserId } from "../shared/role-ceiling";
import { openText, sealText } from "../shared/secure-config";
import { findCodes, reqCodeOf, taskCodeOf } from "../shared/codes";
import { GitError, GitLab, branchNameFor, cleanBaseUrl, validBranchName, type GitLabCommit, type GitLabMR } from "./client";
import { branchCounts, cleanBranchPatterns, closingCodes, isDraftMr, isMergeCommit, isRevertCommit } from "./rules";

/**
 * GitLab 集成（T44）。
 * - 连接（企业级）：企业超管 / 系统超管配；令牌只存密文。
 * - 仓库（项目级）：有「编辑项目」权限的人绑定；Webhook 用随机密钥（只存哈希），同时每 5 分钟用令牌拉取一次兜底（本机收不到外网 Webhook）。
 * - 关联：分支名、提交说明、MR 标题 / 描述 / 源分支里的 R1042 / T1562；只关联同一项目里的需求和任务（别的项目 / 企业的编号忽略）。
 * - 联动：推送 → 任务进行中、需求开发中；MR 合并到默认分支 → 任务完成、需求开发完成（或待测试）；标签 / Release 匹配发版版本号 → 发版上线（过上线关卡）。
 * - 事件按 eventKey 去重，Webhook 和拉取不会重复执行。
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
let fetchImpl: typeof fetch = fetch;
/** 测试用：替换网络请求 */
export function setGitFetch(f: typeof fetch) {
  fetchImpl = f;
}

function clientOf(conn: { baseUrl: string; tokenEnc: string }) {
  const token = openText(conn.tokenEnc);
  if (!token) throw new GitError("令牌读不出来（服务器密钥变了），请重新填写令牌");
  return new GitLab(conn.baseUrl, token, fetchImpl);
}

function fail(e: unknown) {
  if (e instanceof GitError) return result({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
  console.error(e);
  return result({ error: "操作失败，请稍后重试" }, { status: 500 });
}

// ---------- 连接 ----------

/** 能管哪个企业的连接：系统超管任意（含 "" 不属于企业）；企业超管本企业 */
async function adminScope(session: SessionUser): Promise<{ all: boolean; scope: string | null }> {
  if (session.isDemo) return { all: false, scope: null };
  if (session.globalRole === ADMIN_ROLE) return { all: true, scope: null };
  return { all: false, scope: await enterpriseAdminOf(session.id) };
}

export async function listConnections(session: SessionUser) {
  const a = await adminScope(session);
  const mine = (await enterpriseOfUserId(session.id)) || "";
  const where = a.all ? {} : { scope: a.scope ?? mine };
  const rows = await prisma.gitConnection.findMany({ where, orderBy: { createdAt: "asc" }, include: { _count: { select: { repos: true } } } });
  const canEdit = a.all || !!a.scope;
  const names = a.all ? new Map((await prisma.organization.findMany({ where: { id: { in: rows.map((r) => r.scope).filter(Boolean) } }, select: { id: true, name: true } })).map((o) => [o.id, o.name])) : new Map<string, string>();
  return {
    canEdit,
    connections: rows.map((r) => ({
      id: r.id,
      name: r.name,
      provider: r.provider,
      baseUrl: r.baseUrl,
      kind: /^https:\/\/gitlab\.com$/i.test(r.baseUrl) ? "gitlab.com" : "自建",
      tokenHint: canEdit ? r.tokenHint : "",
      allowWrite: r.allowWrite,
      accountName: r.accountName,
      lastCheckAt: r.lastCheckAt?.toISOString() ?? null,
      lastError: r.lastError,
      repos: r._count.repos,
      enterprise: a.all ? names.get(r.scope) || (r.scope ? r.scope : "系统级（所有企业可用）") : null,
    })),
  };
}

/** 新建 / 修改：{ id?, name, baseUrl, token?, allowWrite, enterpriseId? }；保存前用令牌试一次 */
export async function saveConnection(session: SessionUser, body: Record<string, unknown>) {
  const a = await adminScope(session);
  if (!a.all && !a.scope) return result({ error: "只有企业超管或系统超管可以配置代码仓库" }, { status: 403 });
  const existing = body.id ? await prisma.gitConnection.findUnique({ where: { id: String(body.id) } }) : null;
  if (body.id && (!existing || (!a.all && existing.scope !== a.scope))) return result({ error: "连接不存在" }, { status: 404 });
  const name = String(body.name ?? existing?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name) return result({ error: "请填写名称" }, { status: 400 });
  const baseUrl = cleanBaseUrl(body.baseUrl ?? existing?.baseUrl);
  if (!baseUrl) return result({ error: "地址要以 http:// 或 https:// 开头，不带账号密码和参数" }, { status: 400 });
  const token = body.token ? String(body.token).trim() : null;
  if (!existing && !token) return result({ error: "请填写访问令牌" }, { status: 400 });
  if (token && (token.length < 8 || token.length > 300 || /\s/.test(token))) return result({ error: "访问令牌格式不对" }, { status: 400 });
  const scope = existing ? existing.scope : a.all ? String(body.enterpriseId || "") : a.scope!;
  if (a.all && !existing && scope && !(await prisma.organization.findFirst({ where: { id: scope, type: "enterprise" }, select: { id: true } }))) return result({ error: "企业不存在" }, { status: 404 });
  const tokenEnc = token ? sealText(token) : existing!.tokenEnc;
  let accountName: string | null = null;
  try {
    const gl = clientOf({ baseUrl, tokenEnc });
    const [u, v] = await Promise.all([gl.user(), gl.version()]);
    accountName = `${u.username}${v ? ` · GitLab ${v}` : ""}`;
  } catch (e) {
    return fail(e);
  }
  const data = { name, baseUrl, tokenEnc, tokenHint: token ? token.slice(-4) : existing!.tokenHint, allowWrite: body.allowWrite === undefined ? existing?.allowWrite ?? false : Boolean(body.allowWrite), accountName, lastCheckAt: new Date(), lastError: null };
  const row = existing ? await prisma.gitConnection.update({ where: { id: existing.id }, data }) : await prisma.gitConnection.create({ data: { ...data, scope, createdById: session.id } });
  await prisma.activityLog.create({ data: { entityType: "organization", entityId: scope || "system", action: "git_connection", actorId: session.id, message: `${existing ? "修改" : "新建"}代码仓库连接「${name}」` } });
  return result({ id: row.id, accountName });
}

export async function testConnection(session: SessionUser, id: string) {
  const a = await adminScope(session);
  const c = await prisma.gitConnection.findUnique({ where: { id } });
  if (!c || (!a.all && c.scope !== a.scope)) return result({ error: "连接不存在" }, { status: 404 });
  try {
    const gl = clientOf(c);
    const [u, v] = await Promise.all([gl.user(), gl.version()]);
    const accountName = `${u.username}${v ? ` · GitLab ${v}` : ""}`;
    await prisma.gitConnection.update({ where: { id }, data: { accountName, lastCheckAt: new Date(), lastError: null } });
    return result({ ok: true, accountName });
  } catch (e) {
    await prisma.gitConnection.update({ where: { id }, data: { lastCheckAt: new Date(), lastError: e instanceof Error ? e.message.slice(0, 200) : "失败" } });
    return fail(e);
  }
}

export async function deleteConnection(session: SessionUser, id: string) {
  const a = await adminScope(session);
  const c = await prisma.gitConnection.findUnique({ where: { id } });
  if (!c || (!a.all && c.scope !== a.scope)) return result({ error: "连接不存在" }, { status: 404 });
  await prisma.gitConnection.delete({ where: { id } });
  await prisma.activityLog.create({ data: { entityType: "organization", entityId: c.scope || "system", action: "git_connection", actorId: session.id, message: `删除代码仓库连接「${c.name}」（解除了绑定的仓库）` } });
  return result({ ok: true });
}

// ---------- 项目仓库 ----------

async function projectScope(projectId: string) {
  return (await prisma.project.findUnique({ where: { id: projectId }, select: { enterpriseId: true } }))?.enterpriseId || "";
}

export async function projectRepos(session: SessionUser, projectId: string) {
  if (!(await canSeeProject(session, projectId))) return null;
  const canEdit = !session.isDemo && (await can(session, "project.edit", projectId));
  const scope = await projectScope(projectId);
  const [repos, conns] = await Promise.all([
    prisma.gitRepo.findMany({ where: { projectId }, include: { connection: { select: { name: true, allowWrite: true } } }, orderBy: { createdAt: "asc" } }),
    // 本企业的连接 + 系统级连接（系统超管建的，scope 为空，所有企业的项目都能用）
    canEdit ? prisma.gitConnection.findMany({ where: { scope: { in: [...new Set([scope, ""])] } }, select: { id: true, name: true, baseUrl: true } }) : [],
  ]);
  return {
    canEdit,
    connections: conns,
    repos: repos.map((r) => ({
      id: r.id,
      path: r.path,
      webUrl: r.webUrl,
      defaultBranch: r.defaultBranch,
      connection: r.connection.name,
      allowWrite: r.connection.allowWrite,
      afterMerge: r.afterMerge,
      tagPattern: r.tagPattern,
      doneBranches: r.doneBranches,
      requirePipeline: r.requirePipeline,
      webhookPath: `/api/git/webhook/${r.id}`,
      lastWebhookAt: r.lastWebhookAt?.toISOString() ?? null,
      lastPollAt: r.lastPollAt?.toISOString() ?? null,
      lastError: r.lastError,
    })),
  };
}

async function editableProject(session: SessionUser, projectId: string) {
  if (!(await canSeeProject(session, projectId))) return result({ error: "项目不存在" }, { status: 404 });
  if (session.isDemo || !(await can(session, "project.edit", projectId))) return result({ error: "需要「编辑项目」权限" }, { status: 403 });
  return null;
}

const cleanAfterMerge = (v: unknown) => (v === "test_todo" ? "test_todo" : "dev_done");
const cleanPattern = (v: unknown) => {
  const s = String(v ?? "").trim().slice(0, 60);
  return s && s.includes("{version}") && /^[A-Za-z0-9._/{}-]+$/.test(s) ? s : null;
};

/** 绑定：{ connectionId, path, afterMerge?, tagPattern? }；返回 Webhook 地址和密钥（密钥只这一次能看到） */
export async function bindRepo(session: SessionUser, projectId: string, body: Record<string, unknown>) {
  const denied = await editableProject(session, projectId);
  if (denied) return denied;
  const scope = await projectScope(projectId);
  const conn = await prisma.gitConnection.findUnique({ where: { id: String(body.connectionId || "") } });
  if (!conn || (conn.scope !== scope && conn.scope !== "")) return result({ error: "连接不存在（只能用项目所属企业的连接，或系统级连接）" }, { status: 404 });
  const path = String(body.path || "").trim().replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  if (!/^[A-Za-z0-9_.\-/]{1,200}$/.test(path)) return result({ error: "仓库路径写成 分组/项目，如 web/pm-collab" }, { status: 400 });
  try {
    const p = await clientOf(conn).project(path);
    if (await prisma.gitRepo.findFirst({ where: { projectId, remoteId: p.id } })) return result({ error: "这个仓库已经绑定过了" }, { status: 409 });
    const secret = `whs_${randomBytes(24).toString("hex")}`;
    const r = await prisma.gitRepo.create({
      data: { connectionId: conn.id, projectId, remoteId: p.id, path: p.path_with_namespace, webUrl: p.web_url, defaultBranch: p.default_branch || "main", webhookSecretHash: sha256(secret), afterMerge: cleanAfterMerge(body.afterMerge), tagPattern: body.tagPattern === undefined ? "v{version}" : cleanPattern(body.tagPattern), lastPollAt: new Date(Date.now() - 7 * 86400000), createdById: session.id },
    });
    await prisma.activityLog.create({ data: { entityType: "project", entityId: projectId, action: "git_repo", actorId: session.id, message: `绑定代码仓库 ${p.path_with_namespace}` } });
    return result({ id: r.id, webhookPath: `/api/git/webhook/${r.id}`, secret });
  } catch (e) {
    return fail(e);
  }
}

/** 改规则 / 重新生成密钥：{ afterMerge?, tagPattern?, doneBranches?, requirePipeline?, regenerate? } */
export async function updateRepo(session: SessionUser, projectId: string, repoId: string, body: Record<string, unknown>) {
  const denied = await editableProject(session, projectId);
  if (denied) return denied;
  const r = await prisma.gitRepo.findFirst({ where: { id: repoId, projectId } });
  if (!r) return result({ error: "仓库不存在" }, { status: 404 });
  const data: { afterMerge?: string; tagPattern?: string | null; webhookSecretHash?: string; doneBranches?: string; requirePipeline?: boolean } = {};
  if (body.afterMerge !== undefined) data.afterMerge = cleanAfterMerge(body.afterMerge);
  if (body.doneBranches !== undefined) {
    const v = cleanBranchPatterns(body.doneBranches);
    if (v === null) return result({ error: "分支规则只能写分支名和 *，用逗号分开，最多 10 条" }, { status: 400 });
    data.doneBranches = v;
  }
  if (typeof body.requirePipeline === "boolean") data.requirePipeline = body.requirePipeline;
  if (body.tagPattern !== undefined) data.tagPattern = cleanPattern(body.tagPattern);
  let secret: string | null = null;
  if (body.regenerate) {
    secret = `whs_${randomBytes(24).toString("hex")}`;
    data.webhookSecretHash = sha256(secret);
  }
  await prisma.gitRepo.update({ where: { id: r.id }, data });
  return result({ ok: true, ...(secret ? { secret } : {}) });
}

export async function unbindRepo(session: SessionUser, projectId: string, repoId: string) {
  const denied = await editableProject(session, projectId);
  if (denied) return denied;
  const r = await prisma.gitRepo.findFirst({ where: { id: repoId, projectId } });
  if (!r) return result({ error: "仓库不存在" }, { status: 404 });
  await prisma.gitRepo.delete({ where: { id: r.id } });
  await prisma.activityLog.create({ data: { entityType: "project", entityId: projectId, action: "git_repo", actorId: session.id, message: `解除代码仓库 ${r.path}（关联记录一起删除）` } });
  return result({ ok: true });
}

// ---------- 事件处理 ----------

type Repo = { id: string; projectId: string; remoteId: number; defaultBranch: string; webUrl: string; afterMerge: string; tagPattern: string | null; createdById: string; connectionId: string; doneBranches?: string; requirePipeline?: boolean };
type Refs = { reqIds: string[]; taskIds: { id: string; requirementId: string }[] };

/** 编号 → 本项目里的需求 / 任务（别的项目的编号忽略） */
async function refsFromCodes(projectId: string, codes: { reqs: number[]; tasks: number[] }): Promise<Refs> {
  const [rs, ts] = await Promise.all([
    codes.reqs.length ? prisma.requirement.findMany({ where: { number: { in: codes.reqs }, projectId, deletedAt: null }, select: { id: true } }) : [],
    codes.tasks.length ? prisma.requirementTask.findMany({ where: { number: { in: codes.tasks }, requirement: { projectId, deletedAt: null } }, select: { id: true, requirementId: true } }) : [],
  ]);
  return { reqIds: rs.map((r) => r.id), taskIds: ts };
}
const resolveRefs = (projectId: string, text: string) => refsFromCodes(projectId, findCodes(text));
const mergeRefs = (...list: Refs[]): Refs => ({
  reqIds: [...new Set(list.flatMap((r) => r.reqIds))],
  taskIds: list.flatMap((r) => r.taskIds).filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i),
});
const isEmpty = (r: Refs) => !r.reqIds.length && !r.taskIds.length;

type LinkData = { title: string; url: string; author?: string | null; state?: string | null; sourceBranch?: string | null; targetBranch?: string | null; happenedAt?: Date; closes?: boolean; mergeSha?: string | null; pending?: boolean };
async function upsertLink(repo: Repo, kind: string, ref: string, target: { requirementId?: string | null; taskId?: string | null }, data: LinkData) {
  const key = `${repo.id}:${kind}:${ref}:${target.requirementId || ""}:${target.taskId || ""}`;
  const row = { ...data, title: data.title.slice(0, 300), url: data.url.slice(0, 500), author: data.author?.slice(0, 100) ?? null };
  await prisma.gitLink.upsert({ where: { key }, create: { key, repoId: repo.id, kind, ref: ref.slice(0, 200), requirementId: target.requirementId ?? null, taskId: target.taskId ?? null, ...row }, update: row });
}

/** 先记事件；已经处理过（同一个 eventKey）就返回 false */
async function claim(repo: Repo, eventKey: string, kind: string, source: string, summary: string) {
  try {
    await prisma.gitEvent.create({ data: { repoId: repo.id, eventKey: `${repo.id}:${eventKey}`.slice(0, 300), kind, source, summary: summary.slice(0, 300) } });
    return true;
  } catch {
    return false;
  }
}

async function logReq(reqId: string, message: string) {
  await prisma.activityLog.create({ data: { entityType: "requirement", entityId: reqId, action: "updated", actorId: null, message } });
}

/** 任务 待办 → 进行中；需求 待开发 → 开发中 */
async function onWorkStarted(refs: Refs, what: string) {
  const { advanceRequirements } = await import("../requirements/flow");
  const { syncRequirementStatus } = await import("../requirements/tasks");
  for (const t of refs.taskIds) {
    const n = await prisma.requirementTask.updateMany({ where: { id: t.id, status: "todo" }, data: { status: "doing" } });
    if (n.count) {
      const task = await prisma.requirementTask.findUnique({ where: { id: t.id }, select: { number: true } });
      await logReq(t.requirementId, `GitLab ${what}：任务 ${task ? taskCodeOf(task) : ""} 待办 → 进行中`);
      await syncRequirementStatus(null, t.requirementId);
    }
  }
  if (refs.reqIds.length) await advanceRequirements(null, refs.reqIds, "dev_in_progress", `GitLab ${what}`);
}

/** MR 合并（流水线也通过了）：只处理「完成」的编号——任务完成；没有开发任务的需求推进到「开发完成 / 待测试」 */
async function onMerged(repo: Repo, refs: Refs, mr: { iid: number }) {
  const { advanceRequirements } = await import("../requirements/flow");
  const { syncRequirementStatus } = await import("../requirements/tasks");
  const touched = new Set<string>(refs.taskIds.map((t) => t.requirementId));
  for (const t of refs.taskIds) {
    const n = await prisma.requirementTask.updateMany({ where: { id: t.id, status: { in: ["todo", "doing"] } }, data: { status: "done", doneAt: new Date() } });
    if (n.count) {
      const task = await prisma.requirementTask.findUnique({ where: { id: t.id }, select: { number: true } });
      await logReq(t.requirementId, `GitLab MR !${mr.iid} 已合并：任务 ${task ? taskCodeOf(task) : ""} 完成`);
    }
  }
  for (const id of touched) await syncRequirementStatus(null, id);
  const direct = refs.reqIds.filter((id) => !touched.has(id));
  for (const id of direct) {
    const devTasks = await prisma.requirementTask.count({ where: { requirementId: id, kind: { in: ["frontend", "backend", "dev"] }, status: { notIn: ["done", "cancelled"] } } });
    if (devTasks) continue;
    await advanceRequirements(null, [id], repo.afterMerge === "test_todo" ? "test_todo" : "dev_done", `GitLab MR !${mr.iid} 已合并`);
  }
}

/** 推送 / 拉到的提交：合并提交跳过；Revert 只挂关联并在需求上提示，不推状态；其余只把任务推到进行中 */
export async function handleCommits(repo: Repo, commits: Pick<GitLabCommit, "id" | "title" | "message" | "author_name" | "created_at" | "web_url">[], branch: string | null, source: string) {
  const parts: Refs[] = [];
  if (branch) {
    const b = await resolveRefs(repo.projectId, branch);
    const url = `${repo.webUrl}/-/tree/${encodeURIComponent(branch)}`;
    for (const id of b.reqIds) await upsertLink(repo, "branch", branch, { requirementId: id }, { title: branch, url, closes: true });
    for (const t of b.taskIds) await upsertLink(repo, "branch", branch, { requirementId: t.requirementId, taskId: t.id }, { title: branch, url, closes: true });
    parts.push(b);
  }
  for (const c of commits.slice(0, 200)) {
    const msg = c.message || c.title || "";
    if (isMergeCommit(msg)) continue;
    const r = await resolveRefs(repo.projectId, msg);
    if (isEmpty(r)) continue;
    const base = { title: c.title || msg.split("\n")[0], url: c.web_url, author: c.author_name, happenedAt: new Date(c.created_at) };
    for (const id of r.reqIds) await upsertLink(repo, "commit", c.id, { requirementId: id }, base);
    for (const t of r.taskIds) await upsertLink(repo, "commit", c.id, { requirementId: t.requirementId, taskId: t.id }, base);
    if (isRevertCommit(msg)) {
      if (await claim(repo, `revert:${c.id}`, "revert", source, `Revert 提交 ${c.id.slice(0, 8)}`))
        for (const id of new Set([...r.reqIds, ...r.taskIds.map((t) => t.requirementId)])) await logReq(id, `GitLab 有 Revert 提交 ${c.id.slice(0, 8)}「${base.title.slice(0, 60)}」，状态没有自动改，请人工确认`);
      continue;
    }
    parts.push(r);
  }
  const refs = mergeRefs(...parts);
  if (!isEmpty(refs) && (await claim(repo, `push:${branch}:${commits.map((c) => c.id).join(",").slice(0, 200) || "branch"}`, "push", source, `推送 ${branch || ""}：${commits.length} 次提交`))) await onWorkStarted(refs, `推送 ${branch || ""}`.trim());
  return refs;
}

type MrInput = Pick<GitLabMR, "iid" | "title" | "description" | "state" | "source_branch" | "target_branch" | "web_url" | "author" | "merged_at" | "updated_at"> & { draft?: boolean; merge_commit_sha?: string | null };

/**
 * MR：提到的编号都挂关联；「完成」只算 源分支名里的编号 + 关闭词写的编号（+ 系统里为这个分支建的任务）。
 * 草稿 MR 不推状态；合并进不「算完成」的分支只记录；要等流水线的先挂起（pending），流水线成功后再完成。
 */
export async function handleMergeRequest(repo: Repo, mr: MrInput, source: string, conn?: { allowWrite: boolean; baseUrl: string; tokenEnc: string }) {
  const text = `${mr.title} ${mr.description || ""}`;
  const [mentioned, branchOwned, closing] = await Promise.all([resolveRefs(repo.projectId, text), resolveRefs(repo.projectId, mr.source_branch), refsFromCodes(repo.projectId, closingCodes(text))]);
  // 系统里为源分支建的任务（建分支时挂的关联）也算这个分支的
  const viaBranch = await prisma.gitLink.findMany({ where: { repoId: repo.id, kind: "branch", ref: mr.source_branch }, select: { requirementId: true, taskId: true } });
  const owned: Refs = {
    reqIds: viaBranch.filter((l) => l.requirementId && !l.taskId).map((l) => l.requirementId!),
    taskIds: viaBranch.filter((l) => l.taskId && l.requirementId).map((l) => ({ id: l.taskId!, requirementId: l.requirementId! })),
  };
  const done = mergeRefs(branchOwned, closing, owned);
  const refs = mergeRefs(mentioned, done);
  if (isEmpty(refs)) return { refs, done };
  const draft = isDraftMr(mr.title, mr.draft);
  const state = mr.state === "merged" ? "merged" : mr.state === "closed" ? "closed" : draft ? "draft" : "opened";
  const counts = branchCounts(mr.target_branch, repo.doneBranches || "", repo.defaultBranch);
  const waitPipeline = state === "merged" && counts && !!repo.requirePipeline && !!mr.merge_commit_sha;
  const base = { title: mr.title, url: mr.web_url, author: mr.author?.name || mr.author?.username || null, state, sourceBranch: mr.source_branch, targetBranch: mr.target_branch, happenedAt: new Date(mr.merged_at || mr.updated_at), mergeSha: mr.merge_commit_sha || null };
  const isDone = (t: { reqId?: string; taskId?: string }) => (t.taskId ? done.taskIds.some((x) => x.id === t.taskId) : done.reqIds.includes(t.reqId!));
  // 只有新挂起时才写 pending=true；已经处理过（pending 已清）的不再改回
  const firstMerge = state === "merged" && counts && !(await prisma.gitEvent.findUnique({ where: { eventKey: `${repo.id}:mr:${mr.iid}:merged` }, select: { id: true } }));
  for (const id of refs.reqIds) {
    const c = isDone({ reqId: id });
    await upsertLink(repo, "mr", String(mr.iid), { requirementId: id }, { ...base, closes: c, ...(firstMerge ? { pending: waitPipeline && c } : {}) });
  }
  for (const t of refs.taskIds) {
    const c = isDone({ taskId: t.id });
    await upsertLink(repo, "mr", String(mr.iid), { requirementId: t.requirementId, taskId: t.id }, { ...base, closes: c, ...(firstMerge ? { pending: waitPipeline && c } : {}) });
  }
  if (state === "opened" && (await claim(repo, `mr:${mr.iid}:opened`, "mr", source, `MR !${mr.iid} ${mr.title}`))) {
    await onWorkStarted(refs, `MR !${mr.iid}`);
    // 允许写入时，在 MR 里评论这次会带上的需求 / 任务（每个 MR 一次）
    if (conn?.allowWrite) await noteLinked(repo, conn, mr.iid, refs, done).catch(() => undefined);
  }
  if (state === "merged" && counts && (await claim(repo, `mr:${mr.iid}:merged`, "mr", source, `MR !${mr.iid} 合并到 ${mr.target_branch}${waitPipeline ? "（等流水线）" : ""}`))) {
    if (waitPipeline) {
      for (const id of new Set([...done.reqIds, ...done.taskIds.map((t) => t.requirementId)])) await logReq(id, `GitLab MR !${mr.iid} 已合并到 ${mr.target_branch}，等流水线通过后再把任务标为完成`);
    } else await onMerged(repo, done, mr);
  }
  return { refs, done };
}

/** 流水线成功：把这个提交对应的、挂起的 MR 完成 */
export async function handlePipelineSuccess(repo: Repo, sha: string, source: string) {
  const links = await prisma.gitLink.findMany({ where: { repoId: repo.id, kind: "mr", pending: true, mergeSha: sha } });
  if (!links.length) return 0;
  const byMr = new Map<string, typeof links>();
  for (const l of links) byMr.set(l.ref, [...(byMr.get(l.ref) || []), l]);
  for (const [iid, ls] of byMr) {
    await prisma.gitLink.updateMany({ where: { id: { in: ls.map((l) => l.id) } }, data: { pending: false } });
    if (!(await claim(repo, `pipeline:${sha}:${iid}`, "pipeline", source, `MR !${iid} 的流水线通过`))) continue;
    const done: Refs = { reqIds: ls.filter((l) => l.requirementId && !l.taskId && l.closes).map((l) => l.requirementId!), taskIds: ls.filter((l) => l.taskId && l.requirementId && l.closes).map((l) => ({ id: l.taskId!, requirementId: l.requirementId! })) };
    await onMerged(repo, done, { iid: Number(iid) });
  }
  return byMr.size;
}

async function noteLinked(repo: Repo, conn: { baseUrl: string; tokenEnc: string }, iid: number, refs: Refs, done: Refs) {
  const reqs = await prisma.requirement.findMany({ where: { id: { in: [...refs.reqIds, ...refs.taskIds.map((t) => t.requirementId)] } }, select: { id: true, number: true, title: true } });
  const ts = await prisma.requirementTask.findMany({ where: { id: { in: refs.taskIds.map((t) => t.id) } }, select: { id: true, number: true, title: true } });
  const mark = (finish: boolean) => (finish ? "合并后完成" : "只关联");
  const lines = [
    ...reqs.map((r) => `- ${reqCodeOf(r)} ${r.title}${done.reqIds.includes(r.id) ? `（${mark(true)}）` : ""}`),
    ...ts.map((t) => `- ${taskCodeOf(t)} ${t.title}（${mark(done.taskIds.some((x) => x.id === t.id))}）`),
  ];
  if (!lines.length) return;
  const target = repo.doneBranches ? repo.doneBranches.replace(/,/g, " / ") : repo.defaultBranch;
  await clientOf(conn).mrNote(
    repo.remoteId,
    iid,
    `小围空间：这个 MR 关联了\n${lines.join("\n")}\n\n合并到 ${target}${repo.requirePipeline ? " 且流水线通过" : ""} 后，标「合并后完成」的任务自动完成。只是提到的编号不会改状态；要让它也算完成，在描述里写「Closes T1234」或「完成 T1234」。`,
  );
}

/** 标签 / Release：按规则匹配本项目还没上线的发版，标为已上线并同步需求（过上线关卡） */
export async function handleTag(repo: Repo, tag: string, source: string) {
  if (!repo.tagPattern) return null;
  const [pre, post] = repo.tagPattern.split("{version}");
  if (!tag.startsWith(pre) || !tag.endsWith(post) || tag.length <= pre.length + post.length) return null;
  const version = tag.slice(pre.length, tag.length - post.length);
  const rel = await prisma.release.findFirst({ where: { projectId: repo.projectId, version, status: { notIn: ["released", "cancelled"] } }, select: { id: true, version: true } });
  if (!rel) return null;
  if (!(await claim(repo, `tag:${tag}`, "tag", source, `标签 ${tag} → 发版 ${version}`))) return null;
  const u = await prisma.user.findUnique({ where: { id: repo.createdById }, select: { id: true, email: true, name: true, globalRole: true, avatarUrl: true, isActive: true } });
  if (!u?.isActive) return { error: "绑定仓库的人已停用，没能自动上线" };
  const { PATCH } = await import("../releases/id-status");
  const r = await PATCH(u, { id: rel.id }, { status: "released", syncRequirements: true });
  if (r.init && r.init.status >= 400) {
    const error = (r.body as { error?: string }).error || "上线失败";
    await prisma.gitEvent.updateMany({ where: { eventKey: `${repo.id}:tag:${tag}` }, data: { error: error.slice(0, 300) } });
    return { error };
  }
  return { released: rel.version };
}

/** GitLab Webhook：校验 X-Gitlab-Token，按 object_kind 分发 */
export async function handleWebhook(repoId: string, token: string | null, payload: Record<string, unknown>) {
  const repo = await prisma.gitRepo.findUnique({ where: { id: repoId }, include: { connection: true } });
  // 仓库不存在和密钥不对都回 404，不暴露哪个存在
  if (!repo || !token || sha256(token) !== repo.webhookSecretHash) return result({ error: "not found" }, { status: 404 });
  await prisma.gitRepo.update({ where: { id: repo.id }, data: { lastWebhookAt: new Date() } });
  const kind = String(payload.object_kind || payload.event_name || "");
  try {
    if (kind === "push") {
      const ref = String(payload.ref || "");
      const branch = ref.startsWith("refs/heads/") ? ref.slice(11) : null;
      const commits = (Array.isArray(payload.commits) ? payload.commits : []) as { id: string; message: string; title?: string; timestamp: string; url: string; author?: { name?: string } }[];
      const refs = await handleCommits(repo, commits.map((c) => ({ id: c.id, title: c.title || String(c.message || "").split("\n")[0], message: String(c.message || ""), author_name: c.author?.name || "", created_at: c.timestamp, web_url: c.url })), branch, "webhook");
      return result({ ok: true, linked: refs.reqIds.length + refs.taskIds.length });
    }
    if (kind === "merge_request") {
      const a = (payload.object_attributes || {}) as Record<string, unknown>;
      const user = (payload.user || {}) as { name?: string; username?: string };
      const r = await handleMergeRequest(
        repo,
        {
          iid: Number(a.iid),
          title: String(a.title || ""),
          description: a.description ? String(a.description) : null,
          state: String(a.state || ""),
          source_branch: String(a.source_branch || ""),
          target_branch: String(a.target_branch || ""),
          web_url: String(a.url || ""),
          author: { name: user.name || "", username: user.username || "" },
          merged_at: a.merged_at ? String(a.merged_at) : null,
          updated_at: String(a.updated_at || new Date().toISOString()),
          draft: a.draft === true || a.work_in_progress === true,
          merge_commit_sha: a.merge_commit_sha ? String(a.merge_commit_sha) : null,
        },
        "webhook",
        repo.connection,
      );
      return result({ ok: true, linked: r.refs.reqIds.length + r.refs.taskIds.length, done: r.done.reqIds.length + r.done.taskIds.length });
    }
    if (kind === "pipeline") {
      const a = (payload.object_attributes || {}) as Record<string, unknown>;
      if (a.status !== "success" || !a.sha) return result({ ok: true, status: a.status || "" });
      return result({ ok: true, completed: await handlePipelineSuccess(repo, String(a.sha), "webhook") });
    }
    if (kind === "tag_push") {
      const ref = String(payload.ref || "");
      if (!ref.startsWith("refs/tags/") || payload.after === "0000000000000000000000000000000000000000") return result({ ok: true });
      return result({ ok: true, ...((await handleTag(repo, ref.slice(10), "webhook")) || {}) });
    }
    if (kind === "release") {
      const tag = String(payload.tag || "");
      return result({ ok: true, ...((tag && (await handleTag(repo, tag, "webhook"))) || {}) });
    }
    return result({ ok: true, ignored: kind || "unknown" });
  } catch (e) {
    console.error("[GitLab] Webhook 处理失败", e);
    await prisma.gitRepo.update({ where: { id: repo.id }, data: { lastError: "Webhook 处理失败" } });
    return result({ error: "处理失败" }, { status: 500 });
  }
}

/** 定时拉取（兜底：本机收不到外网 Webhook）：上次拉取之后的提交、MR、最近的标签，以及在等流水线的 MR */
export async function pollRepo(repoId: string) {
  const repo = await prisma.gitRepo.findUnique({ where: { id: repoId }, include: { connection: true } });
  if (!repo) return null;
  const since = (repo.lastPollAt || new Date(Date.now() - 7 * 86400000)).toISOString();
  const started = new Date();
  try {
    const gl = clientOf(repo.connection);
    const [commits, mrs, tags] = await Promise.all([gl.commits(repo.remoteId, { since, all: true }), gl.mergeRequests(repo.remoteId, since), repo.tagPattern ? gl.tags(repo.remoteId) : Promise.resolve([])]);
    let linked = 0;
    // 拉取的提交不知道在哪个分支上，只按提交说明认编号；分支名靠 MR 的源分支补
    if (commits.length) linked += (await handleCommits(repo, commits, null, "poll")).reqIds.length;
    for (const mr of mrs) {
      const r = await handleMergeRequest(repo, mr, "poll", repo.connection);
      if (!isEmpty(r.refs)) linked++;
      // 源分支名里有编号时，补一条分支关联
      const b = await resolveRefs(repo.projectId, mr.source_branch);
      const url = `${repo.webUrl}/-/tree/${encodeURIComponent(mr.source_branch)}`;
      for (const id of b.reqIds) await upsertLink(repo, "branch", mr.source_branch, { requirementId: id }, { title: mr.source_branch, url, closes: true });
      for (const t of b.taskIds) await upsertLink(repo, "branch", mr.source_branch, { requirementId: t.requirementId, taskId: t.id }, { title: mr.source_branch, url, closes: true });
    }
    // 在等流水线的 MR：查合并提交的流水线
    const pending = await prisma.gitLink.findMany({ where: { repoId: repo.id, pending: true, mergeSha: { not: null } }, select: { mergeSha: true }, distinct: ["mergeSha"], take: 20 });
    for (const p of pending) {
      const ps = await gl.pipelines(repo.remoteId, p.mergeSha!);
      if (ps.some((x) => x.status === "success")) await handlePipelineSuccess(repo, p.mergeSha!, "poll");
    }
    for (const t of tags.filter((t) => new Date(t.commit.created_at) >= new Date(since)).slice(0, 10)) await handleTag(repo, t.name, "poll");
    await prisma.gitRepo.update({ where: { id: repo.id }, data: { lastPollAt: started, lastError: null } });
    return { ok: true, commits: commits.length, mrs: mrs.length, linked };
  } catch (e) {
    await prisma.gitRepo.update({ where: { id: repo.id }, data: { lastError: (e instanceof Error ? e.message : "拉取失败").slice(0, 200) } });
    return { ok: false, error: e instanceof Error ? e.message : "拉取失败" };
  }
}

/** 队列每 5 分钟调一次：所有绑定的仓库按顺序拉取 */
export async function pollAllRepos() {
  const repos = await prisma.gitRepo.findMany({ select: { id: true }, orderBy: { lastPollAt: "asc" }, take: 50 });
  let n = 0;
  for (const r of repos) if ((await pollRepo(r.id))?.ok) n++;
  return n;
}

export async function syncNow(session: SessionUser, projectId: string, repoId: string) {
  const denied = await editableProject(session, projectId);
  if (denied) return denied;
  const r = await prisma.gitRepo.findFirst({ where: { id: repoId, projectId }, select: { id: true } });
  if (!r) return result({ error: "仓库不存在" }, { status: 404 });
  const out = await pollRepo(r.id);
  return out?.ok ? result(out) : result({ error: out?.error || "同步失败" }, { status: 502 });
}

// ---------- 需求的代码 ----------

export async function requirementCode(session: SessionUser, reqId: string) {
  if (!(await requirementVisible(session, reqId))) return null;
  const r = await prisma.requirement.findUnique({ where: { id: reqId }, select: { id: true, number: true, title: true, projectId: true } });
  if (!r?.projectId) return { repos: [], links: [], branchName: branchNameFor(reqCodeOf(r || { number: 0 }), r?.title || ""), canBranch: false };
  const taskIds = (await prisma.requirementTask.findMany({ where: { requirementId: reqId }, select: { id: true, number: true } }));
  const [repos, links] = await Promise.all([
    prisma.gitRepo.findMany({ where: { projectId: r.projectId }, include: { connection: { select: { allowWrite: true } } } }),
    prisma.gitLink.findMany({ where: { OR: [{ requirementId: reqId }, { taskId: { in: taskIds.map((t) => t.id) } }] }, orderBy: { happenedAt: "desc" }, take: 200 }),
  ]);
  // 同一个 MR / 分支 / 提交只显示一行，带上关联的任务编号
  // tasks = 合并后算完成的任务（分支为它建的或写了关闭词）；mentions = 只是提到的
  const seen = new Map<string, { kind: string; ref: string; title: string; url: string; author: string | null; state: string | null; sourceBranch: string | null; targetBranch: string | null; at: string; tasks: string[]; mentions: string[]; pending: boolean; repo: string }>();
  for (const l of links) {
    const k = `${l.repoId}:${l.kind}:${l.ref}`;
    const row = seen.get(k) || { kind: l.kind, ref: l.ref, title: l.title, url: l.url, author: l.author, state: l.state, sourceBranch: l.sourceBranch, targetBranch: l.targetBranch, at: l.happenedAt.toISOString(), tasks: [], mentions: [], pending: false, repo: repos.find((x) => x.id === l.repoId)?.path || "" };
    const t = l.taskId ? taskIds.find((x) => x.id === l.taskId) : null;
    if (t) (l.kind !== "mr" || l.closes ? row.tasks : row.mentions).push(taskCodeOf(t));
    if (l.pending) row.pending = true;
    seen.set(k, row);
  }
  const canBranch = !session.isDemo && (await can(session, "requirements.edit", r.projectId)) && repos.some((x) => x.connection.allowWrite);
  return {
    repos: repos.map((x) => ({ id: x.id, path: x.path, webUrl: x.webUrl, defaultBranch: x.defaultBranch, allowWrite: x.connection.allowWrite })),
    links: [...seen.values()],
    branchName: branchNameFor(reqCodeOf(r), r.title),
    canBranch,
  };
}

/** 从需求建分支：{ repoId, name?, taskId? }（连接要允许写入） */
export async function createBranch(session: SessionUser, reqId: string, body: Record<string, unknown>) {
  if (!(await requirementVisible(session, reqId))) return result({ error: "需求不存在" }, { status: 404 });
  const r = await prisma.requirement.findUnique({ where: { id: reqId }, select: { id: true, number: true, title: true, projectId: true } });
  if (!r?.projectId) return result({ error: "需求不属于任何项目" }, { status: 400 });
  if (session.isDemo || !(await can(session, "requirements.edit", r.projectId))) return result({ error: "没有编辑这条需求的权限" }, { status: 403 });
  const repo = await prisma.gitRepo.findFirst({ where: { id: String(body.repoId || ""), projectId: r.projectId }, include: { connection: true } });
  if (!repo) return result({ error: "仓库不存在" }, { status: 404 });
  if (!repo.connection.allowWrite) return result({ error: "这个连接只读，不能建分支（企业超管可在「代码仓库」里允许写入）" }, { status: 403 });
  const task = body.taskId ? await prisma.requirementTask.findFirst({ where: { id: String(body.taskId), requirementId: reqId }, select: { id: true, number: true, title: true } }) : null;
  const name = String(body.name || "").trim() || branchNameFor(task ? `${reqCodeOf(r)}-${taskCodeOf(task)}` : reqCodeOf(r), task?.title || r.title);
  if (!validBranchName(name)) return result({ error: "分支名只能用字母、数字和 . _ - /" }, { status: 400 });
  try {
    const b = await clientOf(repo.connection).createBranch(repo.remoteId, name, repo.defaultBranch);
    await upsertLink(repo, "branch", b.name, { requirementId: r.id, taskId: task?.id ?? null }, { title: b.name, url: b.web_url || `${repo.webUrl}/-/tree/${encodeURIComponent(b.name)}`, author: session.name });
    await prisma.activityLog.create({ data: { entityType: "requirement", entityId: r.id, action: "updated", actorId: session.id, message: `在 ${repo.path} 建分支 ${b.name}` } });
    return result({ ok: true, name: b.name });
  } catch (e) {
    return fail(e);
  }
}

/** 关卡「代码已合并」：项目没绑仓库 → null（不拦）；绑了 → 需求或它的任务有已合并的 MR */
export async function codeMergedFor(reqId: string, projectId: string): Promise<boolean | null> {
  if (!(await prisma.gitRepo.count({ where: { projectId } }))) return null;
  const tasks = (await prisma.requirementTask.findMany({ where: { requirementId: reqId }, select: { id: true } })).map((t) => t.id);
  return (await prisma.gitLink.count({ where: { kind: "mr", state: "merged", OR: [{ requirementId: reqId }, { taskId: { in: tasks } }] } })) > 0;
}

// ---------- 发版代码对比 ----------

/** 发版详情的选择项：绑定的仓库、最近的标签和分支 */
export async function releaseRefs(session: SessionUser, releaseId: string, repoId?: string) {
  const rel = await prisma.release.findUnique({ where: { id: releaseId }, select: { projectId: true } });
  if (!rel || !(await canSeeProject(session, rel.projectId))) return null;
  const repos = await prisma.gitRepo.findMany({ where: { projectId: rel.projectId }, include: { connection: true } });
  const repo = repos.find((r) => r.id === repoId) || repos[0];
  if (!repo) return { repos: [], tags: [], branches: [] };
  try {
    const gl = clientOf(repo.connection);
    const [tags, branches] = await Promise.all([gl.tags(repo.remoteId), gl.branches(repo.remoteId)]);
    return { repos: repos.map((r) => ({ id: r.id, path: r.path, defaultBranch: r.defaultBranch })), repoId: repo.id, tags: tags.map((t) => t.name), branches: branches.map((b) => b.name) };
  } catch (e) {
    return { repos: repos.map((r) => ({ id: r.id, path: r.path, defaultBranch: r.defaultBranch })), repoId: repo.id, tags: [], branches: [], error: e instanceof Error ? e.message : "读取失败" };
  }
}

/** 对比：{ repoId, from, to } → 会上线的需求、代码里有但不在发版里的、发版里有但还没合并代码的 */
export async function compareRelease(session: SessionUser, releaseId: string, q: { repoId: string; from: string; to: string }) {
  const rel = await prisma.release.findUnique({ where: { id: releaseId }, include: { items: { select: { requirementId: true } } } });
  if (!rel || !(await canSeeProject(session, rel.projectId))) return result({ error: "发版不存在" }, { status: 404 });
  const repo = await prisma.gitRepo.findFirst({ where: { id: q.repoId, projectId: rel.projectId }, include: { connection: true } });
  if (!repo) return result({ error: "仓库不存在" }, { status: 404 });
  const ref = /^[A-Za-z0-9._/-]{1,200}$/;
  if (!ref.test(q.from) || !ref.test(q.to)) return result({ error: "请选择要对比的标签或分支" }, { status: 400 });
  try {
    const { commits } = await clientOf(repo.connection).compare(repo.remoteId, q.from, q.to);
    const byReq = new Map<string, Set<string>>();
    let unlinked = 0;
    for (const c of commits) {
      const refs = await resolveRefs(rel.projectId, c.message || c.title);
      const ids = [...refs.reqIds, ...refs.taskIds.map((t) => t.requirementId)];
      if (!ids.length) unlinked++;
      for (const id of ids) byReq.set(id, (byReq.get(id) || new Set()).add(c.short_id || c.id.slice(0, 8)));
    }
    // 实现需求的提交也算到父需求名下（发版里放的可能是父需求）
    const inRelease = new Set(rel.items.map((i) => i.requirementId));
    const ids = [...new Set([...byReq.keys(), ...inRelease])];
    const reqs = await prisma.requirement.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, number: true, title: true, status: true, parentId: true } });
    const mrs = await prisma.gitLink.findMany({ where: { repoId: repo.id, kind: "mr", requirementId: { in: ids } }, select: { requirementId: true, ref: true, state: true } });
    const rows = reqs.map((r) => {
      const inCode = byReq.has(r.id) || reqs.some((k) => k.parentId === r.id && byReq.has(k.id));
      const merged = mrs.some((m) => m.requirementId === r.id && m.state === "merged");
      return {
        id: r.id,
        code: reqCodeOf(r),
        title: r.title,
        status: r.status,
        commits: byReq.get(r.id)?.size || 0,
        mrs: [...new Set(mrs.filter((m) => m.requirementId === r.id).map((m) => `!${m.ref}`))],
        verdict: inRelease.has(r.id) ? (inCode || merged ? "ship" : "noCode") : "notInRelease",
      };
    });
    const order = { ship: 0, notInRelease: 1, noCode: 2 } as Record<string, number>;
    rows.sort((a, b) => order[a.verdict] - order[b.verdict] || a.code.localeCompare(b.code));
    return result({ commits: commits.length, unlinked, rows, canManage: await can(session, "releases.manage", rel.projectId) });
  } catch (e) {
    return fail(e);
  }
}

/** 把代码对比里「不在发版里」的需求加进发版 */
export async function addToRelease(session: SessionUser, releaseId: string, body: Record<string, unknown>) {
  const rel = await prisma.release.findUnique({ where: { id: releaseId }, select: { id: true, projectId: true, status: true, version: true } });
  if (!rel || !(await canSeeProject(session, rel.projectId))) return result({ error: "发版不存在" }, { status: 404 });
  if (!(await can(session, "releases.manage", rel.projectId))) return result({ error: "无权限管理发版" }, { status: 403 });
  if (rel.status === "released" || rel.status === "cancelled") return result({ error: "发版已结束" }, { status: 400 });
  const ids = (Array.isArray(body.requirementIds) ? body.requirementIds : []).map(String).slice(0, 100);
  const ok = await prisma.requirement.findMany({ where: { id: { in: ids }, projectId: rel.projectId, deletedAt: null }, select: { id: true } });
  for (const r of ok) await prisma.releaseRequirement.upsert({ where: { releaseId_requirementId: { releaseId: rel.id, requirementId: r.id } }, create: { releaseId: rel.id, requirementId: r.id }, update: {} });
  if (ok.length) await prisma.activityLog.create({ data: { entityType: "release", entityId: rel.id, action: "updated", actorId: session.id, message: `按代码对比加入 ${ok.length} 条需求` } });
  return result({ ok: true, added: ok.length });
}
