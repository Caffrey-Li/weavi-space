"use client";

import { useState } from "react";
import { GitBranch } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";

type Repo = { id: string; path: string; webUrl: string; defaultBranch: string; connection: string; allowWrite: boolean; afterMerge: string; tagPattern: string | null; doneBranches: string; requirePipeline: boolean; webhookPath: string; lastWebhookAt: string | null; lastPollAt: string | null; lastError: string | null };
type Data = { canEdit: boolean; connections: { id: string; name: string; baseUrl: string }[]; repos: Repo[] };

/** 提交规范模板（T49）：提交说明里要有 R1234 / T1234，合并和 Revert 提交除外 */
const RULE = String.raw`(^Merge |^Revert |(^|[^A-Za-z0-9])[RT]-?[0-9]+)`;
const HOOK = [
  "cat > .git/hooks/commit-msg <<'HOOK'",
  "#!/bin/sh",
  "# 提交说明里要有需求编号 R1234 或任务编号 T1234（合并 / Revert 提交除外）",
  `grep -qE '${RULE}' "$1" || { echo "提交说明里要写需求编号（R1234）或任务编号（T1234）"; exit 1; }`,
  "HOOK",
  "chmod +x .git/hooks/commit-msg",
].join("\n");
const CI = [
  "check-commit-codes:",
  // 不能放 .pre：只有 .pre 任务的流水线 GitLab 不会创建（MR 流水线里只有这一个任务）
  "  stage: test",
  "  rules:",
  '    - if: $CI_PIPELINE_SOURCE == "merge_request_event"',
  "  script:",
  '    - git fetch origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"',
  "    - |",
  `      bad=$(git log --format='%s' "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME..HEAD" | grep -vE '${RULE}' || true)`,
  '      if [ -n "$bad" ]; then echo "这些提交没写编号（R1234 / T1234）："; echo "$bad"; exit 1; fi',
].join("\n");

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "操作失败");
  return d;
}
const ago = (iso: string | null) => {
  if (!iso) return "还没有";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "刚刚" : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`;
};

/** 项目 · 代码仓库（T44，Figma 90B）：绑定 GitLab 仓库，给出 Webhook 地址和密钥，自动更新规则 */
export function ProjectGitButton({ projectId, className = "btn-secondary nv-section-btn" }: { projectId: string; className?: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ connectionId: "", path: "", afterMerge: "dev_done", tagPattern: "v{version}" });
  const [secret, setSecret] = useState<{ repoId: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const load = async () => {
    setError("");
    try {
      const d = (await call(`/api/projects/${projectId}/git`, "GET")) as Data;
      setData(d);
      setForm((f) => ({ ...f, connectionId: f.connectionId || d.connections[0]?.id || "" }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const bind = () =>
    run(async () => {
      const d = await call(`/api/projects/${projectId}/git`, "POST", form);
      setSecret({ repoId: d.id, secret: d.secret });
      setForm((f) => ({ ...f, path: "" }));
    }, "已绑定，请到 GitLab 添加 Webhook");
  const regen = (r: Repo) =>
    run(async () => {
      const d = await call(`/api/projects/${projectId}/git/${r.id}`, "PATCH", { regenerate: true });
      setSecret({ repoId: r.id, secret: d.secret });
    }, "已生成新密钥，旧密钥立即失效");
  const unbind = async (r: Repo) => {
    if (!(await confirm({ title: `解除 ${r.path}？`, body: "已有的分支 / 提交 / MR 关联记录会一起删除，需求和任务的状态不受影响。", confirmLabel: "解除", tone: "danger" }))) return;
    await run(() => call(`/api/projects/${projectId}/git/${r.id}`, "DELETE"), "已解除");
  };

  return (
    <>
      <button type="button" className={className} onClick={() => (setOpen(true), void load())}>
        <GitBranch size={14} aria-hidden="true" />
        代码仓库
      </button>
      <Modal open={open} onClose={() => (setOpen(false), setSecret(null))} title="项目代码仓库" wide busy={busy}>
        <div className="nv-ra-form">
          {error ? (
            <div className="banner-error" role="alert">
              {error}
            </div>
          ) : null}
          {!data ? (
            error ? null : <p className="nv-set-hint">正在读取…</p>
          ) : (
            <>
              {data.repos.length ? (
                <ul className="nv-git-list">
                  {data.repos.map((r) => (
                    <li key={r.id}>
                      <div className="min-w-0 flex-1">
                        <p className="nv-git-name">
                          <a className="text-link" href={r.webUrl} target="_blank" rel="noopener noreferrer">
                            {r.path}
                          </a>
                          <span className="nv-dl-tag">{r.connection}</span>
                        </p>
                        <p className="nv-flow-meta">
                          默认分支 {r.defaultBranch} · Webhook 最近收到 {ago(r.lastWebhookAt)} · 定时拉取 {ago(r.lastPollAt)}
                          {r.lastError ? ` · 出错：${r.lastError}` : ""}
                        </p>
                        <p className="nv-flow-meta">
                          Webhook 地址 <code>{origin}{r.webhookPath}</code>
                        </p>
                        {data.canEdit ? (
                          <div className="nv-git-rules">
                            <label>
                              合并到 {r.defaultBranch} 后需求进入
                              <select className="input" value={r.afterMerge} disabled={busy} onChange={(e) => void run(() => call(`/api/projects/${projectId}/git/${r.id}`, "PATCH", { afterMerge: e.target.value }), "已保存")}>
                                <option value="dev_done">开发完成</option>
                                <option value="test_todo">待测试</option>
                              </select>
                            </label>
                            <label>
                              算完成的分支
                              <input
                                className="input"
                                defaultValue={r.doneBranches}
                                placeholder={`${r.defaultBranch}（默认）`}
                                title="逗号分开，支持 *，如 main,master,release/*"
                                disabled={busy}
                                onBlur={(e) => e.target.value !== r.doneBranches && void run(() => call(`/api/projects/${projectId}/git/${r.id}`, "PATCH", { doneBranches: e.target.value }), "已保存分支规则")}
                              />
                            </label>
                            <label>
                              <input type="checkbox" checked={r.requirePipeline} disabled={busy} onChange={(e) => void run(() => call(`/api/projects/${projectId}/git/${r.id}`, "PATCH", { requirePipeline: e.target.checked }), "已保存")} />
                              流水线通过才算完成
                            </label>
                            <label>
                              标签规则
                              <input
                                className="input"
                                defaultValue={r.tagPattern || ""}
                                placeholder="不按标签上线"
                                disabled={busy}
                                onBlur={(e) => e.target.value !== (r.tagPattern || "") && void run(() => call(`/api/projects/${projectId}/git/${r.id}`, "PATCH", { tagPattern: e.target.value }), "已保存标签规则")}
                              />
                            </label>
                          </div>
                        ) : null}
                        {secret?.repoId === r.id ? (
                          <div className="nv-git-secret" role="note">
                            <b>Secret token（只显示这一次，复制到 GitLab 的 Webhook 设置里）</b>
                            <code>{secret.secret}</code>
                          </div>
                        ) : null}
                      </div>
                      {data.canEdit ? (
                        <div className="flex flex-col gap-2">
                          <button type="button" className="btn-secondary nv-head-btn" disabled={busy} onClick={() => void run(() => call(`/api/projects/${projectId}/git/${r.id}/sync`, "POST"), "已同步")}>
                            立即同步
                          </button>
                          <button type="button" className="btn-secondary nv-head-btn" disabled={busy} onClick={() => void regen(r)}>
                            重新生成密钥
                          </button>
                          <button type="button" className="btn-ghost nv-head-btn" disabled={busy} onClick={() => void unbind(r)}>
                            解除绑定
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="nv-set-hint">还没有绑定代码仓库。</p>
              )}
              {data.canEdit ? (
                data.connections.length ? (
                  <div className="nv-git-bind">
                    <b>绑定仓库</b>
                    <div className="nv-task-grid">
                      <label className="nv-ra-field">
                        <span className="nv-ra-label">连接</span>
                        <select className="input" value={form.connectionId} onChange={(e) => setForm({ ...form, connectionId: e.target.value })}>
                          {data.connections.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}（{c.baseUrl}）
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="nv-ra-field">
                        <span className="nv-ra-label">仓库路径</span>
                        <input className="input" value={form.path} placeholder="分组/项目，如 web/pm-collab" onChange={(e) => setForm({ ...form, path: e.target.value })} />
                      </label>
                    </div>
                    <p className="nv-ra-tip">
                      绑定后在 GitLab 项目「设置 › Webhooks」添加上面的地址，勾选 Push、Merge request、Pipeline、Tag push、Releases 事件，Secret token 填系统给的密钥。收不到 Webhook（例如本机、内网）时，系统每 5 分钟用令牌拉取一次，效果一样，只是有几分钟延迟。
                    </p>
                    <div className="flex justify-end">
                      <button type="button" className="btn-primary nv-head-btn" disabled={busy || !form.path.trim() || !form.connectionId} onClick={() => void bind()}>
                        绑定
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="nv-ra-tip">本企业还没有 GitLab 连接，请企业超管先到「系统设置 › 代码仓库」新建一个（gitlab.com 或公司自建都可以）。</p>
                )
              ) : null}
              <details className="nv-ra-tip">
                <summary>
                  <b>提交规范模板（可选）：不带编号的提交直接拒收</b>
                </summary>
                <p>本地钩子（每个开发的电脑上，在仓库目录里执行一次）：</p>
                <pre className="nv-git-snippet">{HOOK}</pre>
                <p>CI 检查（加到仓库的 .gitlab-ci.yml，MR 里有提交没写编号时流水线失败）：</p>
                <pre className="nv-git-snippet">{CI}</pre>
                <p>公司自建的 GitLab 是付费版时，也可以在项目「设置 › 仓库 › 推送规则」的「提交说明必须匹配」里填：{RULE}</p>
              </details>
              <div className="nv-ra-tip">
                <b>自动更新规则</b>
                <br />
                · 分支名、提交说明、MR 标题 / 描述里写 R1042（需求）或 T1562（任务）就会关联；只认本项目的需求和任务。
                <br />· 提交 / 推送只说明「有人在做」：任务「待办 → 进行中」，需求「待开发 → 开发中」；合并提交、Revert、草稿 MR 不推状态（Revert 会在需求上提示）。
                <br />· MR 合并进「算完成的分支」（默认是默认分支，可加 release/*）：只完成两种编号——源分支就是为它建的（feature/R1042-T1004），或 MR 里写了「Closes T1004」「完成 T1004」；只是提到的只挂关联。勾了「流水线通过才算完成」时，等合并后的流水线成功再完成。开发任务都完成时需求进入「开发完成」（可改为「待测试」）。
                <br />· 打标签或发布 GitLab Release，名字符合标签规则（如 v2.4.0 对应发版 2.4.0）：发版标为已上线，需求一起上线（先过上线关卡）。
              </div>
            </>
          )}
        </div>
        <div className="nv-pform-foot">
          <span className="nv-pform-note" />
          <ModalCancelButton className="btn-secondary nv-head-btn">关闭</ModalCancelButton>
        </div>
      </Modal>
    </>
  );
}
