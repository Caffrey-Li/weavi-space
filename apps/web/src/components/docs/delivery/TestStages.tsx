"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Check, CircleAlert, Loader2, Play, Square, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { ImageViewerButton } from "@/components/ui/ImageViewer";

export type RunResult = { code: string; title: string; priority: string; mode: string; status: string; failedStep: number | null; message: string | null; screenshotUrl: string | null; durationMs: number | null; bugId: string | null; bugCreated: boolean; voided: boolean; note: string | null };
type Counts = { total: number; passed: number; failed: number; blocked: number; skipped: number; pending: number; voided: number; rate: number };
export type RunView = { id: string; kind: string; executor: string; claimedAt: string | null; round: number; scope: string; status: string; envName: string | null; envUrl: string; total: number; doneCount: number; currentCode: string | null; error: string | null; createdAt: string; finalizedAt: string | null; reportPageId?: string | null; counts: Counts; results: RunResult[] };
type BugInfo = { id: string; code: string; title: string; status: string; label: string; reopenCount: number };
export type Tests = {
  scripts?: { name: string; size: number; kind?: string; path?: string; url?: string; pageId?: string }[];
  casesPageId?: string | null;
  dev?: { ready: boolean; items: { id: string; code: string; title: string; status: string; label: string; done: boolean }[] };
  login?: { path: string; user: string; pass: string; submit: string; accounts: { match: string; username: string; hasPass: boolean }[] } | null;
  autoRun?: string;
  envOptions: { name: string; url: string }[];
  envName: string | null;
  envUrl: string | null;
  testUser: string | null;
  hasPass: boolean;
  state: "none" | "running" | "fixing" | "retest" | "passed";
  openBugs: number;
  active: RunView | null;
  trial: RunView | null;
  rounds: (RunView & { bugs: BugInfo[] })[];
};

const RUNNING = ["queued", "running", "stopping", "finalizing"];
export const testBusy = (t: Tests | null | undefined) => !!t && (!!(t.active && RUNNING.includes(t.active.status)) || !!(t.trial && ["queued", "running"].includes(t.trial.status)));

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "操作失败，请重试");
  return d;
}

const secs = (ms: number | null) => (ms == null ? "" : ms < 60_000 ? `${(ms / 1000).toFixed(1)} 秒` : `${Math.floor(ms / 60_000)} 分 ${Math.round((ms % 60_000) / 1000)} 秒`);
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "");

function Icon({ status }: { status: string }) {
  if (status === "passed") return <Check size={14} className="nv-tr-ok" aria-label="通过" />;
  if (status === "failed") return <X size={14} className="nv-tr-bad" aria-label="失败" />;
  if (status === "blocked") return <CircleAlert size={14} className="nv-tr-warn" aria-label="阻塞" />;
  if (status === "skipped") return <span className="nv-tr-skip" aria-label="跳过">–</span>;
  return <span className="nv-dl-dot" aria-label="待执行" />;
}

/** 测试环境和账号（只能选产品环境里登记过的地址） */
function Setup({ id, tests, onSaved }: { id: string; tests: Tests; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const fid = useId();
  const [open, setOpen] = useState(!tests.envUrl);
  const [env, setEnv] = useState(tests.envUrl || tests.envOptions[0]?.url || "");
  const [user, setUser] = useState(tests.testUser || "");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  // T55 自动登录 + 按前置条件换账号
  const L = tests.login;
  const [loginOn, setLoginOn] = useState(!!L);
  const [lg, setLg] = useState({ path: L?.path || "/login", user: L?.user || "label=手机号", pass: L?.pass || "label=密码", submit: L?.submit || "role=button[name=登录]" });
  const [accts, setAccts] = useState<{ match: string; username: string; password: string; hasPass: boolean }[]>(() => (L?.accounts || []).map((a) => ({ ...a, password: "" })));
  if (!tests.envOptions.length)
    return <p className="nv-dl-warn-line">项目所属产品还没有登记测试环境地址：到「产品 · 产品环境」里添加测试环境，再回来发起测试。</p>;
  if (!open)
    return (
      <div className="nv-tr-env">
        <div>
          <p className="nv-tr-env-name">{tests.envName}</p>
          <p className="nv-dl-hint is-small">
            {tests.envUrl} · 账号 {tests.testUser || "未填"}
            {tests.hasPass ? " · 密码已加密保存" : ""}
            {tests.login ? ` · 自动登录${tests.login.accounts.length ? `，按前置条件换 ${tests.login.accounts.length} 个账号` : ""}` : ""}
          </p>
        </div>
        <button type="button" className="text-link" onClick={() => setOpen(true)}>
          修改
        </button>
      </div>
    );
  return (
    <form
      className="nv-dl-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await post(`/api/deliveries/${id}`, { action: "testSetup", envUrl: env, testUser: user, testPass: pass, login: loginOn ? { ...lg, accounts: accts } : { enabled: false } });
          setPass("");
          setOpen(false);
          await onSaved();
        } catch (err) {
          toast.error((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="nv-set-field" htmlFor={`${fid}-e`}>
        测试环境
        <select id={`${fid}-e`} className="input" value={env} onChange={(e) => setEnv(e.target.value)}>
          {tests.envOptions.map((o) => (
            <option key={o.url} value={o.url}>
              {o.name} · {o.url}
            </option>
          ))}
        </select>
        <small>来自项目所属产品的「产品环境」；执行时只会访问这个地址，脚本访问其他网址会被拦下</small>
      </label>
      <div className="nv-tr-two">
        <label className="nv-set-field" htmlFor={`${fid}-u`}>
          测试账号
          <input id={`${fid}-u`} className="input" value={user} maxLength={100} autoComplete="off" onChange={(e) => setUser(e.target.value)} />
        </label>
        <label className="nv-set-field" htmlFor={`${fid}-p`}>
          密码
          <input id={`${fid}-p`} className="input" type="password" value={pass} maxLength={200} autoComplete="new-password" placeholder={tests.hasPass ? "已保存，留空不改" : ""} onChange={(e) => setPass(e.target.value)} />
        </label>
      </div>
      <p className="nv-dl-hint is-small">只在执行时填进 {"{{username}}"} / {"{{password}}"}；密码加密保存，不会出现在截图说明、报告和发给模型的内容里。</p>
      <fieldset className="nv-tr-login">
        <label className="nv-tr-login-on">
          <input type="checkbox" checked={loginOn} onChange={(e) => setLoginOn(e.target.checked)} />
          自动登录：前置条件里写了「登录」的用例（不是「未登录」），先登录再执行
        </label>
        {loginOn ? (
          <>
            <div className="nv-tr-two">
              <label className="nv-set-field">
                登录页路径
                <input className="input" value={lg.path} maxLength={300} onChange={(e) => setLg({ ...lg, path: e.target.value })} />
              </label>
              <label className="nv-set-field">
                登录按钮
                <input className="input" value={lg.submit} maxLength={200} onChange={(e) => setLg({ ...lg, submit: e.target.value })} />
              </label>
              <label className="nv-set-field">
                账号输入框
                <input className="input" value={lg.user} maxLength={200} onChange={(e) => setLg({ ...lg, user: e.target.value })} />
              </label>
              <label className="nv-set-field">
                密码输入框
                <input className="input" value={lg.pass} maxLength={200} onChange={(e) => setLg({ ...lg, pass: e.target.value })} />
              </label>
            </div>
            <div className="nv-set-field">
              <span>按前置条件换账号（从上往下，第一个关键词出现在前置条件里就用它的账号；都不匹配用上面的测试账号）</span>
              {accts.map((a, i) => (
                <div key={i} className="nv-tr-acct">
                  <input className="input" aria-label="关键词" placeholder="关键词，如：V3 会员" value={a.match} maxLength={60} onChange={(e) => setAccts(accts.map((x, j) => (j === i ? { ...x, match: e.target.value } : x)))} />
                  <input className="input" aria-label="账号" placeholder="账号" value={a.username} maxLength={100} autoComplete="off" onChange={(e) => setAccts(accts.map((x, j) => (j === i ? { ...x, username: e.target.value } : x)))} />
                  <input className="input" aria-label="密码" type="password" placeholder={a.hasPass ? "已保存，留空不改" : "密码（留空用默认密码）"} value={a.password} maxLength={200} autoComplete="new-password" onChange={(e) => setAccts(accts.map((x, j) => (j === i ? { ...x, password: e.target.value } : x)))} />
                  <button type="button" className="text-link is-quiet" onClick={() => setAccts(accts.filter((_, j) => j !== i))}>
                    删除
                  </button>
                </div>
              ))}
              <button type="button" className="text-link" onClick={() => setAccts([...accts, { match: "", username: "", password: "", hasPass: false }])} disabled={accts.length >= 20}>
                + 加一个账号
              </button>
            </div>
          </>
        ) : null}
      </fieldset>
      <div className="nv-dl-barrow">
        <span className="nv-dl-spacer" />
        {tests.envUrl ? (
          <button type="button" className="btn-secondary nv-head-btn" onClick={() => setOpen(false)}>
            取消
          </button>
        ) : null}
        <button type="submit" className="btn-primary nv-head-btn" disabled={busy || !env}>
          保存
        </button>
      </div>
    </form>
  );
}

/** T39：提测自动执行 + 自定义测试脚本（脚本只交给「在我的电脑执行」的本机 Agent，服务器不运行上传的代码） */
function Automation({ id, tests, onSaved }: { id: string; tests: Tests; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const fid = useId();
  const [busy, setBusy] = useState(false);
  const save = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      await post(`/api/deliveries/${id}`, body);
      toast.success(ok);
      await onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  async function pick(list: FileList | null) {
    if (!list?.length) return;
    const add: { name: string; content: string }[] = [];
    for (const f of Array.from(list)) {
      if (f.size > 200_000) {
        toast.error(`${f.name} 超过 200 KB`);
        continue;
      }
      add.push({ name: f.name, content: await f.text() });
    }
    if (add.length) await save({ action: "scripts", add }, `已上传 ${add.length} 个脚本`);
  }
  const scripts = tests.scripts || [];
  const [adding, setAdding] = useState<"local" | "doc" | "url" | null>(null);
  const [val, setVal] = useState("");
  const addDoc = async (pageId: string, name: string) => {
    await save({ action: "scripts", add: [{ kind: "doc", pageId, name }] }, "已添加");
    setAdding(null);
  };
  const addScript = async () => {
    const v = val.trim();
    if (adding === "doc") {
      const m = v.match(/pages\/([a-z0-9]{10,40})/i) || v.match(/^([a-z0-9]{10,40})$/i);
      if (!m) return toast.error("粘贴文档页面的链接（地址里带 /pages/…）");
      return addDoc(m[1], `文档脚本 · ${m[1].slice(-6)}`);
    }
    const name = (v.split(/[\\/?#]/).filter(Boolean).pop() || v).replace(/[^\w\u4e00-\u9fa5.\-· ]/g, "-").slice(0, 80);
    await save({ action: "scripts", add: [adding === "local" ? { kind: "local", path: v, name } : { kind: "url", url: v, name }] }, "已添加");
    setAdding(null);
  };
  return (
    <div className="nv-tr-auto">
      <label className="nv-set-field" htmlFor={`${fid}-a`}>
        提测后自动执行
        <select id={`${fid}-a`} className="input" value={tests.autoRun || "off"} disabled={busy || !tests.envUrl} onChange={(e) => void save({ action: "autoRun", autoRun: e.target.value }, "已保存")}>
          <option value="off">不自动执行</option>
          <option value="server">需求进入「待测试」时，在服务器上自动跑一轮</option>
          <option value="local">需求进入「待测试」时，排一轮等我电脑上的 Agent 领取</option>
        </select>
        <small>{tests.envUrl ? "用开启人的身份发起，跑完同样要人点「完成本轮」提 Bug、写测试记录" : "先选择测试环境"}</small>
      </label>
      <div className="nv-set-field">
        <span>自定义测试脚本（{scripts.length}）</span>
        {scripts.length ? (
          <ul className="nv-tr-scripts">
            {scripts.map((x) => (
              <li key={x.name}>
                <span className="nv-dl-tag">{SCRIPT_KIND[x.kind || "upload"]}</span>
                <code title={x.path || x.url || x.name}>{x.kind === "local" ? x.path : x.kind === "url" ? x.url : x.name}</code>
                <span>{x.kind === "doc" ? "随文档更新" : x.kind === "local" || x.kind === "url" ? "本机 Agent 读取" : `${(x.size / 1024).toFixed(1)} KB`}</span>
                <button type="button" className="text-link is-quiet" disabled={busy} onClick={() => void save({ action: "scripts", remove: x.name }, "已移除")}>
                  移除
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="nv-tr-addscripts">
          <label className="btn-secondary nv-head-btn nv-skfiles-add" htmlFor={`${fid}-f`}>
            + 上传文件
            <input id={`${fid}-f`} type="file" multiple accept=".ts,.js,.mjs,.cjs,.py,.yaml,.yml,.json,.md,.txt" className="sr-only" disabled={busy} onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
          </label>
          {(["local", "doc", "url"] as const).map((k) => (
            <button key={k} type="button" className="btn-secondary nv-head-btn" aria-pressed={adding === k} disabled={busy} onClick={() => { setAdding(adding === k ? null : k); setVal(""); }}>
              + {SCRIPT_KIND[k]}
            </button>
          ))}
        </div>
        {adding ? (
          <form
            className="nv-tr-addform"
            onSubmit={(e) => {
              e.preventDefault();
              void addScript();
            }}
          >
            {adding === "doc" && tests.casesPageId ? (
              <button type="button" className="text-link" disabled={busy} onClick={() => void addDoc(tests.casesPageId!, "Playwright · 本需求测试用例")}>
                用本需求测试用例生成的 Playwright 脚本
              </button>
            ) : null}
            <input
              className="input"
              aria-label={adding === "local" ? "本机路径" : adding === "url" ? "脚本地址" : "文档链接"}
              value={val}
              placeholder={adding === "local" ? "~/projects/mall/tests/member.spec.ts" : adding === "url" ? "https://gitlab.example.com/…/raw/main/e2e/member.spec.ts" : "粘贴系统里文档的链接，如 /docs/…/pages/…"}
              onChange={(e) => setVal(e.target.value)}
            />
            <button type="submit" className="btn-primary nv-head-btn" disabled={busy || !val.trim()}>
              添加
            </button>
          </form>
        ) : null}
        <small>脚本只交给「在我的电脑执行」时本机的 Agent 运行，服务器只按用例的结构化步骤执行。本机路径和其他地址由本机 Agent 自己读取；系统文档在领取时按最新内容生成（用例页 → Playwright 脚本，普通文档 → 页面里的代码块）。最多 10 个。</small>
      </div>
    </div>
  );
}

const SCRIPT_KIND: Record<string, string> = { upload: "上传文件", local: "本机路径", doc: "系统文档", url: "其他地址" };

function ResultRow({ r }: { r: RunResult }) {
  return (
    <li className="nv-tr-row" data-status={r.status}>
      <div className="nv-tr-top">
        <Icon status={r.status} />
        <span className="nv-tr-code">{r.code}</span>
        <span className="nv-tr-title">{r.title}</span>
        <span className="nv-tr-time">{r.voided ? "误报" : secs(r.durationMs)}</span>
      </div>
      {r.message && r.status !== "passed" ? (
        <p className="nv-tr-msg">
          {r.status === "blocked" ? "阻塞：" : ""}
          {r.failedStep ? `第 ${r.failedStep} 步 ` : ""}
          {r.message}
        </p>
      ) : null}
      {r.screenshotUrl ? (
        <ImageViewerButton className="nv-tr-shot" src={r.screenshotUrl} alt={`${r.code} 失败截图`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.screenshotUrl} alt="" />
          <span>失败截图 · 点击放大</span>
        </ImageViewerButton>
      ) : null}
      {r.bugId ? (
        <Link className="text-link nv-tr-bug" href={`/bugs/${r.bugId}`}>
          {r.bugCreated ? "已提 Bug" : "关联 Bug"} →
        </Link>
      ) : null}
    </li>
  );
}

/** 测试阶段：环境 → 发起 → 执行进度和结果 → 手工用例 → 完成本轮 */
export function TestStage({ id, tests, canEdit, casesConfirmed, reload, onFinalized }: { id: string; tests: Tests; canEdit: boolean; casesConfirmed: boolean; reload: (refresh?: boolean) => Promise<void>; onFinalized: (runId?: string) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [scope, setScope] = useState<"all" | "failed">("all");
  const [executor, setExecutor] = useState<"server" | "local">("server");
  const [busy, setBusy] = useState(false);
  const act = async (body: Record<string, unknown>, ok?: string, refresh = false) => {
    setBusy(true);
    try {
      await post(`/api/deliveries/${id}`, body);
      if (ok) toast.success(ok);
      await reload(refresh);
      if (body.action === "finalize") onFinalized(String(body.runId || ""));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!casesConfirmed) return <p className="nv-dl-empty">先确认测试用例，再发起测试。</p>;
  const run = tests.active;
  const auto = run?.results.filter((r) => r.mode === "auto") ?? [];
  const manual = run?.results.filter((r) => r.mode === "manual") ?? [];
  const pct = run && run.total ? Math.round((run.doneCount / run.total) * 100) : 0;
  return (
    <div className="nv-dl-body">
      {canEdit ? <Setup id={id} tests={tests} onSaved={() => reload(false)} /> : null}
      {canEdit && tests.envOptions.length ? <Automation id={id} tests={tests} onSaved={() => reload(false)} /> : null}
      {run ? (
        <section className="nv-tr-run" aria-label={`第 ${run.round} 轮`}>
          <div className="nv-dl-barrow">
            <strong className="nv-tr-head">
              第 {run.round} 轮 ·{" "}
              {run.executor === "local" && run.status === "queued" ? "等你电脑上的 Agent 领取" : run.executor === "local" && run.status === "running" ? `在我的电脑执行 · 已回传 ${run.doneCount} / ${run.total}` : run.status === "queued" ? "排队中" : run.status === "running" ? `执行中 ${run.doneCount} / ${run.total}` : run.status === "stopping" ? "正在停止…" : run.status === "manual" ? "等你填手工用例" : run.status === "finalizing" ? "正在提 Bug、写测试记录…" : "自动用例跑完了"}
            </strong>
            <span className="nv-dl-spacer" />
            {canEdit && ["queued", "running", "manual", "done"].includes(run.status) ? (
              <button
                type="button"
                className="btn-secondary nv-head-btn"
                disabled={busy}
                onClick={async () => {
                  if (await confirm({ title: "停止这一轮？", body: "已经跑完的结果会保留，但这一轮不会提 Bug、不写测试记录。", confirmLabel: "停止", tone: "danger" })) await act({ action: "stop", runId: run.id }, "已停止");
                }}
              >
                <Square size={12} aria-hidden="true" />
                停止
              </button>
            ) : null}
          </div>
          {run.executor === "local" && ["queued", "running"].includes(run.status) ? (
            <div className="nv-tr-local">
              <p>在你电脑上的 Agent（Claude Code、Cursor 等）里说：</p>
              <code>用小围空间内置的 caffrey-test-runner 执行需求交付的测试，run id：{run.id}，结果回传</code>
              <button type="button" className="text-link" onClick={() => void navigator.clipboard?.writeText(`用小围空间内置的 caffrey-test-runner 执行需求交付的测试，run id：${run.id}，结果回传`).then(() => toast.success("已复制"))}>
                复制这句话
              </button>
              <p className="nv-dl-hint is-small">
                {run.claimedAt ? "Agent 已领取，正在执行。" : "还没有领取。"}第一次用：到{" "}
                <Link className="text-link" href="/settings/agents">
                  设置 · 本机 Agent
                </Link>{" "}
                添加你用的 Agent（勾选「编辑文档」），按生成的配置写进去并测试连通。
              </p>
            </div>
          ) : null}
          {run.executor !== "local" && ["queued", "running", "stopping"].includes(run.status) ? (
            <>
              <div className="nv-tr-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="nv-dl-hint is-small">
                {run.currentCode ? `当前：${run.currentCode} · ` : ""}
                {run.envUrl}
              </p>
            </>
          ) : null}
          <ul className="nv-tr-list">
            {auto.map((r) => (
              <ResultRow key={r.code} r={r} />
            ))}
          </ul>
          {manual.length ? (
            <div className="nv-tr-manual">
              <p>手工用例 {manual.length} 条{manual.some((r) => r.status === "pending") ? "：可以逐条给结论，也可以批量处理；不填也能确认，没给结论的记为「跳过」" : ""}</p>
              {canEdit && run.status !== "finalizing" && manual.some((r) => r.status === "pending") ? (
                <div className="nv-tr-bulk">
                  <button type="button" className="btn-secondary nv-head-btn" disabled={busy} onClick={() => void act({ action: "manualBulk", runId: run.id, status: "passed" }, "没给结论的手工用例已全部标为通过")}>
                    全部通过
                  </button>
                  <button type="button" className="btn-secondary nv-head-btn" disabled={busy} onClick={() => void act({ action: "manualBulk", runId: run.id, status: "skipped" }, "没给结论的手工用例已全部标为跳过")}>
                    全部跳过
                  </button>
                </div>
              ) : null}
              <ul>
                {manual.map((r) => (
                  <ManualRow key={r.code} r={r} editable={canEdit && run.status !== "finalizing"} busy={busy} onSet={(status, note, shot) => act({ action: "manual", runId: run.id, code: r.code, status, note, screenshotBase64: shot })} />
                ))}
              </ul>
            </div>
          ) : null}
          {canEdit && (run.status === "done" || run.status === "manual") ? (
            <div className="nv-tr-finish">
              <p className="nv-dl-hint is-small">确认后：失败的用例提到项目 Bug 清单（同一用例已有没关闭的 Bug 就只追加备注，已解决的改成重新打开），通过的关闭对应 Bug，写进 PRD 末尾的测试记录，接着自动生成测试报告。</p>
              <button
                type="button"
                className="btn-primary nv-dl-go"
                disabled={busy}
                onClick={async () => {
                  const left = manual.filter((r) => r.status === "pending").length;
                  if (left && !(await confirm({ title: "确认本轮结果？", body: `还有 ${left} 条手工用例没给结论，确认后记为「跳过」（未执行）。`, confirmLabel: "确认并生成报告" }))) return;
                  await act({ action: "finalize", runId: run.id }, "本轮结果已确认，正在生成测试报告", true);
                }}
              >
                {busy ? "处理中…" : "确认结果，生成测试报告"}
              </button>
            </div>
          ) : null}
        </section>
      ) : canEdit && tests.envUrl ? (
        <div className="nv-dl-form">
          <p className="nv-dl-form-title">{tests.rounds.length ? `第 ${tests.rounds[0].round + 1} 轮 · 回归` : "第 3 步 · 执行测试"}</p>
          {tests.rounds.length ? (
            <label className="nv-set-field">
              回归范围
              <select className="input" value={scope} onChange={(e) => setScope(e.target.value as "all" | "failed")}>
                <option value="all">全量（推荐，防止改坏其他功能）</option>
                <option value="failed">只跑上轮失败的</option>
              </select>
            </label>
          ) : (
            <p className="nv-dl-hint">系统用服务器上的浏览器按脚本步骤执行自动用例，手工用例由你填结果。完成本轮后，失败的自动提到项目 Bug 清单，并写进 PRD 末尾的测试记录。</p>
          )}
          {tests.state === "fixing" ? <p className="nv-dl-warn-line">上一轮还有 {tests.openBugs} 个 Bug 没解决，现在回归大概率还会失败。</p> : null}
          <div className="nv-set-field">
            在哪里执行
            <div className="nv-pform-seg nv-tr-seg" role="group" aria-label="在哪里执行">
              <button type="button" aria-pressed={executor === "server"} onClick={() => setExecutor("server")}>
                服务器（Web）
              </button>
              <button type="button" aria-pressed={executor === "local"} onClick={() => setExecutor("local")}>
                我的电脑（本机 Agent）
              </button>
            </div>
            <small>测 App、小程序、桌面应用选「我的电脑」：由你电脑上的 Agent（Claude Code、Cursor 等）通过 MCP 领取用例执行，结果回传到这里</small>
          </div>
          {tests.dev && !tests.dev.ready ? (
            <p className="nv-dl-warn-line">
              需求还没开发完成（{tests.dev.items.filter((x) => !x.done).map((x) => `${x.code}「${x.label}」`).slice(0, 3).join("、")}），开发完成后才能正式测试；现在可以在用例页「试跑」单条用例。
            </p>
          ) : null}
          <button type="button" className="btn-primary nv-dl-go" disabled={busy || (!!tests.dev && !tests.dev.ready)} onClick={() => void act({ action: "run", kind: "round", scope, executor }, tests.rounds.length ? "已提交回归" : "已发起测试")}>
            <Play size={14} aria-hidden="true" />
            {tests.rounds.length ? "提交回归" : "发起测试"}
          </button>
          <p className="nv-dl-hint is-small">{executor === "server" ? "同一时间全系统只跑一轮，其余排队；一轮最长 30 分钟。" : "发起后把面板里那句话发给你的 Agent，它会领取用例、执行并逐条回传。"}</p>
        </div>
      ) : null}
      {run?.error ? <p className="nv-dl-error">{run.error}</p> : null}
      {!run && tests.rounds[0]?.error ? <p className="nv-dl-error">{tests.rounds[0].error}</p> : null}
    </div>
  );
}

/** 读本地图片为 base64（不含 data: 前缀）；只收 PNG / JPEG，≤ 5 MB */
export function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg)$/.test(file.type)) return reject(new Error("截图只支持 PNG / JPEG"));
    if (file.size > 5 * 1024 * 1024) return reject(new Error("截图不能超过 5 MB"));
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]+,/, ""));
    fr.onerror = () => reject(new Error("读取图片失败"));
    fr.readAsDataURL(file);
  });
}

function ManualRow({ r, editable, busy, onSet }: { r: RunResult; editable: boolean; busy: boolean; onSet: (status: "passed" | "failed", note?: string, shot?: string) => Promise<void> }) {
  const toast = useToast();
  const [failing, setFailing] = useState(false);
  const [shot, setShot] = useState<{ name: string; data: string } | null>(null);
  const [note, setNote] = useState(r.note || "");
  return (
    <li>
      <div className="nv-tr-mrow">
        <span className="nv-tr-code">{r.code}</span>
        <span className="nv-tr-title">{r.title}</span>
        {editable ? (
          <span className="nv-tr-pick" role="group" aria-label={`${r.code} 结果`}>
            <button type="button" aria-pressed={r.status === "passed"} disabled={busy} onClick={() => void onSet("passed")}>
              通过
            </button>
            <button type="button" aria-pressed={r.status === "failed"} disabled={busy} onClick={() => setFailing(true)}>
              失败
            </button>
          </span>
        ) : (
          <Icon status={r.status} />
        )}
      </div>
      {failing ? (
        <form
          className="nv-tr-note"
          onSubmit={async (e) => {
            e.preventDefault();
            await onSet("failed", note, shot?.data);
            setShot(null);
            setFailing(false);
          }}
        >
          <input className="input" value={note} maxLength={500} placeholder="失败的现象（会写进 Bug）" aria-label={`${r.code} 失败的现象`} onChange={(e) => setNote(e.target.value)} autoFocus />
          <label className="btn-secondary nv-head-btn nv-tr-file">
            {shot ? "已选截图" : "截图"}
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              aria-label={`${r.code} 失败截图`}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  setShot({ name: f.name, data: await readImage(f) });
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            />
          </label>
          <button type="submit" className="btn-primary nv-head-btn" disabled={busy}>
            确定
          </button>
        </form>
      ) : r.status === "failed" && r.note ? (
        <p className="nv-tr-msg">{r.note}</p>
      ) : null}
      {!failing && r.status === "failed" && r.screenshotUrl ? (
        <ImageViewerButton className="text-link nv-tr-bug" src={r.screenshotUrl} alt={`${r.code} 截图`}>
          查看截图
        </ImageViewerButton>
      ) : null}
    </li>
  );
}

/** 报告阶段：每轮统计、Bug 状态、误报取消；全部通过显示「测试通过」 */
/** T54 报告生成中：右侧按对话显示请求和实时进度（正文实时显示在左侧文档区） */
function ReportGen({ id, request }: { id: string; request: string }) {
  const [live, setLive] = useState<{ chars: number; section: string; startedAt: string } | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const tick = async () => {
      try {
        const r = await fetch(`/api/deliveries/${id}/live?what=report`, { cache: "no-store" });
        const j = (await r.json()) as { active?: boolean; chars?: number; html?: string; startedAt?: string };
        if (alive && j.active) {
          const hs = [...String(j.html || "").matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g)];
          setLive({ chars: j.chars || 0, section: hs.length ? hs[hs.length - 1][1].replace(/<[^>]+>/g, "").slice(0, 40) : "", startedAt: j.startedAt || "" });
        }
      } catch {
        /* 下次再取 */
      }
      if (alive) {
        setNow(Date.now());
        timer = window.setTimeout(() => void tick(), 1200);
      }
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [id]);
  const secs = live?.startedAt && now ? Math.max(0, Math.round((now - new Date(live.startedAt).getTime()) / 1000)) : 0;
  return (
    <div className="nv-dl-chat nv-dl-gen nv-tr-reportgen" aria-live="polite">
      <div className="nv-dl-msg is-me">
        <p>{request}</p>
      </div>
      <div className="nv-dl-msg is-ai is-stream">
        <span className="nv-dl-who">小围</span>
        <p className="nv-dl-writing">
          <Loader2 size={12} className="nv-spin" aria-hidden="true" />
          {live?.chars ? `正在写${live.section ? `：${live.section}` : "测试报告"} · 已写 ${live.chars.toLocaleString("zh-CN")} 字` : "正在整理本轮结果、连接模型…"}
          <span className="nv-dl-writing-sub">报告实时显示在左侧{secs ? ` · 用时 ${secs < 60 ? `${secs} 秒` : `${Math.floor(secs / 60)} 分 ${secs % 60} 秒`}` : ""}</span>
        </p>
      </div>
    </div>
  );
}

export function ReportStage({ id, tests, canEdit, prdHref, reload, toTest, spaceId, skills = [], credentialId, model, model: modelName, onReporting, onReportDone, messages = [], autoRunId, onAutoDone }: { id: string; tests: Tests; canEdit: boolean; prdHref: string | null; reload: (refresh?: boolean) => Promise<void>; toTest: () => void; spaceId?: string; skills?: { id: string; name: string }[]; credentialId?: string; model?: string; onReporting?: (on: boolean) => void; onReportDone?: (pageId: string) => void; messages?: { id: string; content: string; createdAt: string }[]; autoRunId?: string | null; onAutoDone?: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  // T35：用选定的 skill 把某一轮的结果写成测试报告页
  const [reportSkill, setReportSkill] = useState("builtin:test-report");
  const [reporting, setReporting] = useState<string | null>(null);
  const makeReport = async (runId: string) => {
    setReporting(runId);
    onReporting?.(true);
    try {
      const r = await post(`/api/deliveries/${id}`, { action: "report", runId, skillId: reportSkill, credentialId, model });
      toast.success("测试报告已生成");
      await reload(true);
      if (r?.pageId) onReportDone?.(r.pageId);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReporting(null);
      onReporting?.(false);
    }
  };
  // T57：确认本轮后自动生成测试报告（有可用模型时），只触发一次
  const [autoTried, setAutoTried] = useState<string | null>(null);
  useEffect(() => {
    if (!autoRunId || autoTried === autoRunId || !canEdit || reporting) return;
    if (!tests.rounds.some((r) => r.id === autoRunId)) return;
    setAutoTried(autoRunId);
    onAutoDone?.();
    if (!credentialId) {
      toast.error("没有可用的模型，先在「设置 · 模型管理」里添加，再点「生成测试报告」");
      return;
    }
    void makeReport(autoRunId);
    // makeReport 每次渲染都是新函数；只按这些值触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunId, tests.rounds, canEdit, credentialId]);
  const latest = tests.rounds[0];
  if (!latest) return <p className="nv-dl-empty">完成一轮测试后，这里会显示测试报告。</p>;
  const reportingRound = reporting ? tests.rounds.find((r) => r.id === reporting) : null;
  if (reportingRound)
    return <ReportGen id={id} request={`生成测试报告 · 第 ${reportingRound.round} 轮 · ${skills.find((s) => s.id === reportSkill)?.name || "测试报告生成"}${modelName ? ` · ${modelName}` : ""}`} />;
  return (
    <div className="nv-dl-body">
      {messages.length ? (
        <div className="nv-tr-msgs">
          {messages.slice(-3).map((m) => (
            <div key={m.id} className="nv-dl-msg is-ai">
              <span className="nv-dl-who">小围 · {fmt(m.createdAt)}</span>
              <p>{m.content}</p>
            </div>
          ))}
        </div>
      ) : null}
      {tests.state === "passed" ? (
        <div className="nv-tr-pass">
          <p>测试通过</p>
          <span>
            {latest.counts.skipped
              ? `第 ${latest.round} 轮执行的 ${latest.counts.passed} 条全部通过，${latest.counts.skipped} 条跳过（未执行）· 共 ${tests.rounds.length} 轮`
              : `第 ${latest.round} 轮 ${latest.counts.total} 条用例全部通过 · 共 ${tests.rounds.length} 轮`}
          </span>
        </div>
      ) : tests.state === "fixing" ? (
        <p className="nv-dl-warn-line">第 {latest.round} 轮还有 {tests.openBugs} 个 Bug 没解决。都解决后会通知你提交回归。</p>
      ) : tests.state === "retest" ? (
        <p className="nv-dl-warn-line">第 {latest.round} 轮的 Bug 都处理了，可以提交回归。</p>
      ) : null}
      <div className="nv-dl-barrow">
        {prdHref ? (
          <Link className="text-link" href={prdHref}>
            查看测试记录（PRD 末尾）
          </Link>
        ) : null}
        <span className="nv-dl-spacer" />
        {canEdit && tests.state !== "running" ? (
          <button type="button" className={tests.state === "passed" ? "btn-secondary nv-head-btn" : "btn-primary nv-head-btn"} onClick={toTest}>
            {tests.state === "passed" ? "再跑一轮" : "提交回归"}
          </button>
        ) : null}
      </div>
      {tests.rounds.map((r, i) => (
        <section key={r.id} className="nv-tr-round">
          <p className="nv-tr-head">
            第 {r.round} 轮 · {fmt(r.finalizedAt)} · {r.scope === "failed" ? "只跑上轮失败" : "全量"}
          </p>
          <p className="nv-tr-chips">
            <span className="nv-dl-tag tone-success">通过 {r.counts.passed}</span>
            <span className={`nv-dl-tag${r.counts.failed ? " tone-danger" : ""}`}>失败 {r.counts.failed}</span>
            <span className="nv-dl-tag">阻塞 {r.counts.blocked}</span>
            <span className="nv-dl-tag">通过率 {r.counts.rate}%</span>
          </p>
          <div className="nv-dl-barrow">
            {r.reportPageId && spaceId ? (
              <Link className="text-link" href={`/docs/${spaceId}/pages/${r.reportPageId}`}>
                查看测试报告
              </Link>
            ) : null}
            <span className="nv-dl-spacer" />
            {canEdit ? (
              <>
                <select className="input nv-tr-skill" aria-label="测试报告用的 skill" value={reportSkill} onChange={(e) => setReportSkill(e.target.value)}>
                  {(skills.some((s) => s.id === "builtin:test-report") ? skills : [{ id: "builtin:test-report", name: "测试报告生成" }, ...skills]).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-secondary nv-head-btn" disabled={reporting !== null} onClick={() => void makeReport(r.id)}>
                  {reporting === r.id ? "生成中…" : r.reportPageId ? "重新生成报告" : "生成测试报告"}
                </button>
              </>
            ) : null}
          </div>
          {r.bugs.length ? (
            <ul className="nv-tr-bugs">
              {r.bugs.map((b) => (
                <li key={b.id}>
                  <Link className="text-link" href={`/bugs/${b.id}`}>
                    {b.code}
                  </Link>
                  <span className="nv-tr-title">{b.title}</span>
                  <span className={`nv-dl-tag${b.status === "closed" ? " tone-success" : b.status === "cancelled" ? "" : " tone-warn"}`}>{b.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {canEdit && i === 0 && r.results.some((x) => x.bugCreated && !x.voided) ? (
            <button
              type="button"
              className="text-link is-quiet"
              onClick={async () => {
                if (!(await confirm({ title: "本轮误报一键取消？", body: "这一轮新提的 Bug 会改成「已取消」，对应结果算误报，测试记录随之更新。", confirmLabel: "取消这些 Bug", tone: "danger" }))) return;
                try {
                  const d = await post(`/api/deliveries/${id}`, { action: "void", runId: r.id });
                  toast.success(`已取消 ${d.voided} 个 Bug`);
                  await reload(true);
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              本轮误报一键取消
            </button>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/** 用例页「试跑这条」：只跑这一条，不提 Bug、不写测试记录 */
export function TrialButton({ deliveryId, pageId, code }: { deliveryId: string; pageId: string; code: string }) {
  const toast = useToast();
  const [state, setState] = useState<"idle" | "running">("idle");
  const [res, setRes] = useState<RunResult | null>(null);
  useEffect(() => {
    if (state !== "running") return;
    const t = window.setInterval(async () => {
      const d = await fetch(`/api/deliveries?pageId=${encodeURIComponent(pageId)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      const trial: RunView | undefined = d?.tests?.trial;
      if (trial && !["queued", "running"].includes(trial.status)) {
        setState("idle");
        setRes(trial.results.find((x) => x.code === code) || null);
        if (trial.error) toast.error(trial.error);
      }
    }, 2500);
    return () => window.clearInterval(t);
  }, [state, pageId, code, toast]);
  return (
    <>
      <button
        type="button"
        className="btn-secondary nv-head-btn"
        disabled={state === "running"}
        onClick={async () => {
          setRes(null);
          try {
            await post(`/api/deliveries/${deliveryId}`, { action: "run", kind: "trial", code });
            setState("running");
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      >
        {state === "running" ? <Loader2 size={14} className="nv-spin" aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
        {state === "running" ? "试跑中…" : "试跑这条"}
      </button>
      {res ? (
        <span className={`nv-tr-trial is-${res.status}`}>
          {res.status === "passed" ? `通过 · ${secs(res.durationMs)}` : `${res.status === "blocked" ? "阻塞" : "失败"}${res.failedStep ? ` · 第 ${res.failedStep} 步` : ""}：${res.message || ""}`}
          {res.screenshotUrl ? (
            <>
              {" "}
              <ImageViewerButton className="text-link" src={res.screenshotUrl} alt="试跑截图">
                截图
              </ImageViewerButton>
            </>
          ) : null}
        </span>
      ) : null}
    </>
  );
}
