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
  scripts?: { name: string; size: number }[];
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
          await post(`/api/deliveries/${id}`, { action: "testSetup", envUrl: env, testUser: user, testPass: pass });
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
                <code>{x.name}</code>
                <span>{(x.size / 1024).toFixed(1)} KB</span>
                <button type="button" className="text-link is-quiet" disabled={busy} onClick={() => void save({ action: "scripts", remove: x.name }, "已删除")}>
                  删除
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <label className="btn-secondary nv-head-btn nv-skfiles-add" htmlFor={`${fid}-f`}>
          上传脚本
          <input id={`${fid}-f`} type="file" multiple accept=".ts,.js,.mjs,.cjs,.py,.yaml,.yml,.json,.md,.txt" className="sr-only" disabled={busy} onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
        </label>
        <small>Playwright 等脚本只交给「在我的电脑执行」时你本机的 Agent 运行；服务器上只按用例的结构化步骤执行，不运行上传的代码。最多 10 个，每个 200 KB 以内。</small>
      </div>
    </div>
  );
}

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
export function TestStage({ id, tests, canEdit, casesConfirmed, reload, onFinalized }: { id: string; tests: Tests; canEdit: boolean; casesConfirmed: boolean; reload: (refresh?: boolean) => Promise<void>; onFinalized: () => void }) {
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
      if (body.action === "finalize") onFinalized();
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
              <p>手工用例 {manual.length} 条{manual.some((r) => r.status === "pending") ? "，等你填结果" : ""}</p>
              <ul>
                {manual.map((r) => (
                  <ManualRow key={r.code} r={r} editable={canEdit && run.status !== "finalizing"} busy={busy} onSet={(status, note, shot) => act({ action: "manual", runId: run.id, code: r.code, status, note, screenshotBase64: shot })} />
                ))}
              </ul>
            </div>
          ) : null}
          {canEdit && (run.status === "done" || run.status === "manual") ? (
            <div className="nv-tr-finish">
              <p className="nv-dl-hint is-small">完成后：失败的用例提到项目 Bug 清单（同一用例已有没关闭的 Bug 就只追加备注，已解决的改成重新打开），通过的关闭对应 Bug，并写进 PRD 末尾的测试记录。</p>
              <button type="button" className="btn-primary nv-dl-go" disabled={busy || run.status !== "done"} onClick={() => void act({ action: "finalize", runId: run.id }, "本轮已完成", true)}>
                {busy ? "处理中…" : "完成本轮"}
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
          <button type="button" className="btn-primary nv-dl-go" disabled={busy} onClick={() => void act({ action: "run", kind: "round", scope, executor }, tests.rounds.length ? "已提交回归" : "已发起测试")}>
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
export function ReportStage({ id, tests, canEdit, prdHref, reload, toTest, spaceId, skills = [], credentialId, model }: { id: string; tests: Tests; canEdit: boolean; prdHref: string | null; reload: (refresh?: boolean) => Promise<void>; toTest: () => void; spaceId?: string; skills?: { id: string; name: string }[]; credentialId?: string; model?: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  // T35：用选定的 skill 把某一轮的结果写成测试报告页
  const [reportSkill, setReportSkill] = useState("builtin:test-report");
  const [reporting, setReporting] = useState<string | null>(null);
  const makeReport = async (runId: string) => {
    setReporting(runId);
    try {
      await post(`/api/deliveries/${id}`, { action: "report", runId, skillId: reportSkill, credentialId, model });
      toast.success("测试报告已生成");
      await reload(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReporting(null);
    }
  };
  const latest = tests.rounds[0];
  if (!latest) return <p className="nv-dl-empty">完成一轮测试后，这里会显示测试报告。</p>;
  return (
    <div className="nv-dl-body">
      {tests.state === "passed" ? (
        <div className="nv-tr-pass">
          <p>测试通过</p>
          <span>
            第 {latest.round} 轮 {latest.counts.total} 条用例全部通过 · 共 {tests.rounds.length} 轮
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
