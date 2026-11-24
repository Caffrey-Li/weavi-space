"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Loader2, Maximize2, Minimize2, MoveHorizontal, PanelRightClose, Send, Sparkles } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { refreshDocsTree } from "@/components/docs/DocsNav";
import { scrollToRev, setLiveDoc, setRevisions, setRunLive, type Rev } from "./revisions";
import { setPanelCover, setPanelMode, type PanelMode } from "./panel-mode";
import { ReportStage, TestStage, testBusy, type Tests } from "./TestStages";

type Stage = "prd" | "cases";
type View = Stage | "design" | "dev" | "test" | "report" | "online";
type Sugg = { id: string; title: string; op: string; status: "pending" | "applied" | "ignored" | "undone" | "failed"; before: string; after: string; error?: string; index?: number; html?: string };
type Msg = { id: string; stage: Stage; role: "user" | "assistant"; content: string; suggestions: Sugg[]; createdAt: string };
type PageRef = { id: string; title: string; version: number; hasDraft: boolean };
type Data = {
  delivery: null | {
    id: string;
    prdStatus: string;
    casesStatus: string;
    prdConfirmedVersion: number | null;
    casesConfirmedVersion: number | null;
    casesStale: boolean;
    prdSkillId: string | null;
    casesSkillId: string | null;
    credentialId: string | null;
    model: string | null;
    error: string | null;
    splitCount: number;
    progress: Progress | null;
    protoStatus?: string;
    protoVersion?: number;
    protoSkillId?: string | null;
    reviewStatus?: string;
    reviewPageId?: string | null;
  };
  role: "source" | "prd" | "cases" | "report" | "review";
  canEdit: boolean;
  canStart: boolean;
  source: { id: string; title: string; chars: number } | null;
  prd?: (PageRef & { openQuestions: string[]; features: string[] }) | null;
  cases?: (PageRef & { summary: { total: number; auto: number; manual: number }; coverage: { total: number; covered: number; missing: string[] } }) | null;
  messages?: Msg[];
  tests?: Tests | null;
  /** 11-23 PRD 确认后关联需求的开发 / 上线进度 */
  reqs?: ReqProgress | null;
  design?: {
    prototype: { version: number; href: string } | null;
    artifacts: { id: string; requirementId: string; kind: string; source: string; title: string; href: string | null; note: string | null }[];
    owners: string[];
    review: { id: string; title: string; verdict: string | null } | null;
  };
};
type ReqProgress = { ready: boolean; projectId: string; online: { done: number; total: number }; devCount: { done: number; total: number }; items: { id: string; code: string; title: string; status: string; label: string; done: boolean; online: boolean }[] };
type Progress = {
  what: "prd" | "cases" | "prototype" | "review";
  stage: "prepare" | "connect" | "think" | "write" | "save";
  model: string;
  inputChars: number;
  attachments: number;
  connectMs: number | null;
  thinkChars: number;
  textChars: number;
  preview: string;
  thinkPreview?: string;
  thinkStartedAt?: string | null;
  writeStartedAt?: string | null;
  note: string | null;
  ageMs: number;
  elapsedMs: number;
};
type ModelOpt = { credentialId: string; model: string; label: string; disabled: boolean };
type SkillOpt = { id: string; name: string; builtin: boolean };

const PRD_STATUS: Record<string, string> = { none: "未开始", generating: "生成中", draft: "草稿", confirmed: "已确认", failed: "生成失败" };

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "操作失败，请重试");
  return d;
}

/** 需求交付面板：四段进度 + 当前阶段的操作 + 和小围的对话（修改建议点「应用」才写入页面） */
export function DeliveryPanel({ pageId, spaceId, mode }: { pageId: string; spaceId: string; mode: PanelMode }) {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState("");
  const [stage, setStage] = useState<View | null>(null);
  const [models, setModels] = useState<ModelOpt[] | null>(null);
  const [skills, setSkills] = useState<SkillOpt[]>([]);
  const [chosen, setChosen] = useState("");
  const wasBusy = useRef(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/deliveries?pageId=${encodeURIComponent(pageId)}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setLoadError(d.error || "加载失败");
    setLoadError("");
    setData(d as Data);
  }, [pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/ai/models", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { options?: ModelOpt[] }) => setModels(d.options || []))
      .catch(() => setModels([]));
    fetch("/api/skills", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { builtin?: SkillOpt[]; enterprise?: SkillOpt[]; mine?: SkillOpt[] }) => setSkills([...(d.builtin || []), ...(d.enterprise || []), ...(d.mine || [])]))
      .catch(() => setSkills([]));
  }, []);

  // 默认模型：上次用的，否则第一个可用的
  const okModels = (models || []).filter((o) => !o.disabled).map((o) => `${o.credentialId}|${o.model}`);
  const lastModel = data?.delivery?.credentialId && data.delivery.model ? `${data.delivery.credentialId}|${data.delivery.model}` : "";
  const pick = chosen && okModels.includes(chosen) ? chosen : okModels.includes(lastModel) ? lastModel : okModels[0] || "";
  const setPick = setChosen;

  const d = data?.delivery;
  const generating = d?.prdStatus === "generating" || d?.casesStatus === "generating" || d?.protoStatus === "generating" || d?.reviewStatus === "generating";
  const running = testBusy(data?.tests);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(t);
  }, [running, load]);
  // T57：当前一轮（没有就最近完成的一轮）交给左侧用例页对照显示
  const liveRun = data?.tests?.active || data?.tests?.rounds[0] || null;
  const liveKey = liveRun ? `${liveRun.id}:${liveRun.status}:${liveRun.doneCount}:${liveRun.currentCode}:${(liveRun as { currentStep?: number | null }).currentStep ?? ""}:${liveRun.results.map((r) => r.status).join("")}` : "";
  useEffect(() => {
    if (!liveRun) return setRunLive(null);
    setRunLive({
      pageId,
      id: liveRun.id,
      round: liveRun.round,
      status: liveRun.status,
      total: liveRun.total,
      doneCount: liveRun.doneCount,
      currentCode: liveRun.currentCode,
      currentStep: (liveRun as { currentStep?: number | null }).currentStep ?? null,
      createdAt: liveRun.createdAt,
      finalized: liveRun.status === "finalized",
      results: liveRun.results.map((r) => ({ code: r.code, status: r.status, failedStep: r.failedStep, message: r.message, screenshotUrl: r.screenshotUrl, durationMs: r.durationMs, mode: r.mode })),
    });
    // liveKey 已包含 liveRun 里和显示有关的变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey, pageId]);
  useEffect(() => () => setRunLive(null), []);
  const busy = generating;
  // T53：生成中文档区实时显示；写完自动打开生成的页面（在原始文档页上时）
  const [reportingLive, setReportingLive] = useState(false);
  const [autoReport, setAutoReport] = useState<string | null>(null);
  const genWhat: "prd" | "cases" | "report" | "prototype" | "review" | null = d?.prdStatus === "generating" ? "prd" : d?.casesStatus === "generating" ? "cases" : d?.protoStatus === "generating" ? "prototype" : d?.reviewStatus === "generating" ? "review" : reportingLive ? "report" : null;
  const wasWhat = useRef<{ prd?: string; cases?: string; review?: string } | null>(null);
  const srcTitle = data?.source?.title || "";
  const deliveryId = d?.id || "";
  useEffect(() => {
    if (!genWhat || !deliveryId) return setLiveDoc(null);
    setLiveDoc({ pageId, deliveryId, what: genWhat, title: genWhat === "prd" ? `PRD · ${srcTitle}` : genWhat === "cases" ? `测试用例 · ${srcTitle}` : genWhat === "prototype" ? `原型 · ${srcTitle}` : genWhat === "review" ? `AI 评审 · ${srcTitle}` : "测试报告" });
  }, [genWhat, deliveryId, pageId, srcTitle]);
  useEffect(() => () => setLiveDoc(null), []);
  useEffect(() => {
    if (!busy) {
      if (wasBusy.current) {
        wasBusy.current = false;
        refreshDocsTree();
        router.refresh();
        if (d?.error && !d.error.includes("已停止")) toast.error(d.error);
      }
      return;
    }
    wasBusy.current = true;
    const t = window.setInterval(() => void load(), 1500);
    return () => window.clearInterval(t);
  }, [busy, load, router, toast, d?.error]);
  // 写完自动打开生成的页面（PRD / 用例），已经在那一页就不动
  const prdStatus = d?.prdStatus;
  const casesStatus = d?.casesStatus;
  const prdPage = data?.prd?.id;
  const casesPage = data?.cases?.id;
  const reviewStatus = d?.reviewStatus;
  const reviewPage = d?.reviewPageId || undefined;
  useEffect(() => {
    const prev = wasWhat.current;
    wasWhat.current = { prd: prdStatus, cases: casesStatus, review: reviewStatus };
    if (!prev) return;
    const to = prev.prd === "generating" && prdStatus === "draft" ? prdPage : prev.cases === "generating" && casesStatus === "draft" ? casesPage : prev.review === "generating" && reviewStatus === "done" ? reviewPage : null;
    if (to && to !== pageId) router.push(`/docs/${spaceId}/pages/${to}`);
  }, [prdStatus, casesStatus, reviewStatus, prdPage, casesPage, reviewPage, pageId, spaceId, router]);

  const tests = data?.tests;
  const current: View =
    stage ??
    (data?.role === "report"
      ? "report"
      : data?.role === "review"
        ? "design"
      : tests?.active
        ? "test"
        : tests?.state === "passed" && tests.rounds[0]?.reportPageId
          ? "online"
          : tests && tests.state !== "none"
          ? "report"
          : d?.casesStatus === "confirmed"
            ? tests?.dev && !tests.dev.ready
              ? "dev"
              : "test"
            : data?.role === "cases" || (d?.prdStatus === "confirmed" && d?.casesStatus !== "none")
              ? "cases"
              : d?.prdStatus === "confirmed" || d?.protoStatus === "generating" || d?.reviewStatus === "generating"
                ? "design"
                : "prd");
  const [prdPrefill, setPrdPrefill] = useState("");
  const [credentialId, model] = pick.split("|");

  const after = useCallback(
    async (refresh = true) => {
      await load();
      if (refresh) router.refresh();
    },
    [load, router],
  );

  // 在 PRD / 用例自己的页面上对照修改时，「展开」只加宽对话栏，不盖住文档
  const besideDoc = (current === "prd" && data?.role === "prd") || (current === "cases" && data?.role === "cases");
  useEffect(() => {
    setPanelCover(!besideDoc);
    return () => setPanelCover(true);
  }, [besideDoc]);
  const shown = mode === "wide" && besideDoc ? "open" : mode;

  return (
    <aside className="nv-dl-panel" data-mode={shown} data-wider={mode === "wide" && besideDoc ? "" : undefined} aria-label="需求交付">
      <div className="nv-dl-head">
        <div className="nv-dl-headrow">
          <h2>需求交付</h2>
          <button type="button" className="icon-button" onClick={() => setPanelMode(mode === "wide" ? "open" : "wide")} aria-label={mode === "wide" ? "还原面板宽度" : besideDoc ? "加宽对话栏" : "展开面板"} title={mode === "wide" ? "还原" : besideDoc ? "加宽" : "展开"}>
            {mode === "wide" ? <Minimize2 size={15} aria-hidden="true" /> : besideDoc ? <MoveHorizontal size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
          </button>
          <button type="button" className="icon-button" onClick={() => setPanelMode("closed")} aria-label="收起面板" title="收起">
            <PanelRightClose size={16} aria-hidden="true" />
          </button>
        </div>
        <Stepper data={data} current={current} onPick={setStage} />
      </div>
      {loadError ? <p className="nv-dl-empty">{loadError}</p> : !data ? <p className="nv-dl-empty">正在加载…</p> : null}
      {data ? (
        current === "test" && d && tests ? (
          <TestStage
            id={d.id}
            tests={tests}
            canEdit={data.canEdit}
            casesConfirmed={d.casesStatus === "confirmed"}
            reload={after}
            onFinalized={(runId) => {
              setAutoReport(runId || null);
              setStage("report");
            }}
          />
        ) : current === "report" && d && tests ? (
          <ReportStage id={d.id} tests={tests} canEdit={data.canEdit} prdHref={data.prd ? `/docs/${spaceId}/pages/${data.prd.id}` : null} reload={after} toTest={() => setStage("test")} spaceId={spaceId} skills={skills} credentialId={credentialId} model={model} onReporting={setReportingLive} onReportDone={(id) => id !== pageId && router.push(`/docs/${spaceId}/pages/${id}`)} messages={(data.messages || []).filter((m) => (m.stage as string) === "report")} autoRunId={autoReport} onAutoDone={() => setAutoReport(null)} />
        ) : current === "prd" ? (
          <PrdStage data={data} spaceId={spaceId} pageId={pageId} skills={skills} models={models} pick={pick} setPick={setPick} credentialId={credentialId} model={model} after={after} prefill={prdPrefill} />
        ) : current === "design" ? (
          <DesignStage
            data={data}
            spaceId={spaceId}
            skills={skills}
            models={models}
            pick={pick}
            setPick={setPick}
            credentialId={credentialId}
            model={model}
            after={after}
            goStage={setStage}
            editPrd={(t) => {
              setPrdPrefill(t);
              setStage("prd");
            }}
          />
        ) : current === "dev" ? (
          <DevStage data={data} goTest={() => setStage("test")} />
        ) : current === "online" ? (
          <OnlineStage data={data} />
        ) : (
          <CasesStage data={data} spaceId={spaceId} skills={skills} models={models} pick={pick} setPick={setPick} credentialId={credentialId} model={model} after={after} />
        )
      ) : null}
    </aside>
  );
}

/** T58 原型与设计：生成 / 修改原型、UI 设计稿（含「用 Figma 设计」）、AI 评审；完成后去生成用例 */
function DesignStage({ data, spaceId, skills, models, pick, setPick, credentialId, model, after, goStage, editPrd }: StageProps & { goStage: (v: View) => void; editPrd: (t: string) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const fid = useId();
  const d = data.delivery!;
  const ds = data.design;
  const proto = ds?.prototype || null;
  const owners = ds?.owners || [];
  const uiList = (ds?.artifacts || []).filter((a) => a.kind === "ui");
  const protoArts = (ds?.artifacts || []).filter((a) => a.kind === "prototype" && a.source === "file" && !a.title.startsWith("原型 · 需求交付"));
  const [form, setForm] = useState<null | { mode: "new" | "modify"; base: string; note: string }>(proto || protoArts.length ? null : { mode: "new", base: "current", note: "" });
  const [ui, setUi] = useState<null | { title: string; url: string }>(null);
  const [figma, setFigma] = useState(false);
  const [busy, setBusy] = useState(false);
  const msgs = (data.messages || []).filter((m) => (m.stage as string) === "design");
  const lastAi = [...msgs].reverse().find((m) => m.role === "assistant");
  const act = async (body: Record<string, unknown>, ok?: string) => {
    setBusy(true);
    try {
      await post(`/api/deliveries/${d.id}`, body);
      if (ok) toast.success(ok);
      await after(false);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (d.protoStatus === "generating")
    return <Generating what="原型" request={`生成原型 · ${skills.find((x) => x.id === d.protoSkillId)?.name || "原型图生成"} · ${d.model || ""}`} progress={d.progress || null} onStop={async () => void (await act({ action: "stopGenerate", what: "prototype" }, "已停止生成"))} />;
  if (d.reviewStatus === "generating")
    return <Generating what=" AI 评审" request={`AI 评审 · 按 PRD、原型和 UI 做需求验证 · ${d.model || ""}`} progress={d.progress || null} onStop={async () => void (await act({ action: "stopGenerate", what: "review" }, "已停止"))} />;
  const issues = lastAi && /AI 评审结论/.test(lastAi.content) ? lastAi.content : "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const figmaPrompt = [
    `请用 Figma 为需求「${data.source?.title || ""}」设计 UI。`,
    `1. 先读需求文档（PRD）：${data.prd ? `${origin}/docs/${spaceId}/pages/${data.prd.id}` : "（还没有 PRD）"}${proto ? `\n   原型：${origin}${proto.href}（需要登录小围空间查看）` : ""}`,
    "2. 在 Figma 里按 PRD 和原型画出主要页面，包含空状态、加载、异常和权限受限状态，组件尽量用团队设计系统。",
    owners.length
      ? `3. 画完后调用小围空间 MCP 工具 add_requirement_artifact，把设计稿地址写回需求：{"id":"${owners[0]}","kind":"ui","source":"link","title":"UI 设计稿 · ${(data.source?.title || "").slice(0, 30)}","url":"<Figma 文件或页面的分享链接>"}。需求页和需求文档里会自动显示。`
      : "3. 画完后把 Figma 分享链接贴回这里的「添加 UI 地址」。",
  ].join("\n");
  return (
    <div className="nv-dl-body nv-ds">
      {d.error ? <p className="nv-dl-error">{d.error}</p> : null}
      {lastAi ? (
        <div className="nv-dl-msg is-ai">
          <span className="nv-dl-who">小围</span>
          <p>{lastAi.content}</p>
        </div>
      ) : null}
      <section className="nv-ds-sec" aria-labelledby={`${fid}-p`}>
        <div className="nv-ds-head">
          <h3 id={`${fid}-p`}>原型</h3>
          {proto ? <span className="nv-dl-tag tone-success">第 {proto.version} 版{owners.length ? " · 已挂到需求" : ""}</span> : null}
          <span className="nv-dl-spacer" />
          {proto ? (
            <a className="text-link" href={proto.href} target="_blank" rel="noreferrer">
              打开预览
            </a>
          ) : null}
        </div>
        {proto ? (
          <a className="nv-ds-thumb" href={proto.href} target="_blank" rel="noreferrer" aria-label="打开原型预览">
            <iframe src={proto.href} title="原型缩略图" sandbox="allow-scripts" tabIndex={-1} />
          </a>
        ) : null}
        {data.canEdit && !form ? (
          <div className="nv-dl-barrow">
            {proto ? (
              <button type="button" className="btn-secondary nv-head-btn" onClick={() => setForm({ mode: "modify", base: "current", note: "" })}>
                按说明修改原型
              </button>
            ) : null}
            <button type="button" className="btn-secondary nv-head-btn" onClick={() => setForm({ mode: proto || !protoArts.length ? "new" : "modify", base: protoArts[0]?.id || "current", note: "" })}>
              {proto ? "重新生成" : "生成原型"}
            </button>
          </div>
        ) : null}
        {data.canEdit && form ? (
          <form
            className="nv-dl-form nv-ds-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await act({ action: "prototype", mode: form.mode, base: form.base, note: form.note, skillId: "builtin:prototype", credentialId, model });
              if (ok) setForm(null);
            }}
          >
            <label className="nv-ds-radio">
              <input type="radio" checked={form.mode === "new"} onChange={() => setForm({ ...form, mode: "new" })} />
              新建原型（按已确认的 PRD）
            </label>
            {proto || protoArts.length ? (
              <label className="nv-ds-radio">
                <input type="radio" checked={form.mode === "modify"} onChange={() => setForm({ ...form, mode: "modify" })} />
                基于已有原型修改：
                <select className="input nv-dl-model-mini" value={form.base} disabled={form.mode !== "modify"} onChange={(e) => setForm({ ...form, base: e.target.value })} aria-label="要修改的原型">
                  {proto ? <option value="current">当前原型 第 {proto.version} 版</option> : null}
                  {protoArts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                      {a.note ? `（${a.note}）` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="nv-set-field" htmlFor={`${fid}-n`}>
              {form.mode === "modify" ? "修改要求" : "补充说明（可选）"}
              <textarea id={`${fid}-n`} className="input nv-set-textarea" rows={3} maxLength={4000} value={form.note} placeholder={form.mode === "modify" ? "例如：卡包页加「已过期」分组，详情页加使用记录" : "例如：只做小程序端，突出领卡入口"} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </label>
            <div className="nv-dl-barrow">
              <ModelSelect id={`${fid}-m`} models={models} pick={pick} setPick={setPick} compact />
              <span className="nv-dl-spacer" />
              {proto || protoArts.length ? (
                <button type="button" className="btn-secondary nv-head-btn" onClick={() => setForm(null)}>
                  取消
                </button>
              ) : null}
              <button type="submit" className="btn-primary nv-head-btn" disabled={busy || !pick || (form.mode === "modify" && !form.note.trim())}>
                {form.mode === "modify" ? "修改原型" : "生成原型"}
              </button>
            </div>
            <p className="nv-dl-hint is-small">生成时左侧实时预览；完成后作为「原型」资料挂到需求上，需求页和需求文档里都能点开预览。</p>
          </form>
        ) : null}
      </section>

      <section className="nv-ds-sec" aria-labelledby={`${fid}-u`}>
        <div className="nv-ds-head">
          <h3 id={`${fid}-u`}>UI 设计</h3>
          <span className="nv-dl-tag">{uiList.length} 个</span>
        </div>
        {uiList.length ? (
          <ul className="nv-ds-list">
            {uiList.map((a) => (
              <li key={a.id}>
                {a.href ? (
                  <a className="text-link" href={a.href} target="_blank" rel="noreferrer">
                    {a.title}
                  </a>
                ) : (
                  a.title
                )}
                {a.note ? <span>{a.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="nv-dl-hint is-small">还没有 UI 设计稿。加上 Figma 等线上地址后，需求页和需求文档里都会显示。</p>
        )}
        {data.canEdit ? (
          owners.length ? (
            ui ? (
              <form
                className="nv-ds-uiform"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    const r = await fetch(`/api/requirements/${owners[0]}/artifacts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "ui", source: "link", title: ui.title || "UI 设计稿", url: ui.url }) });
                    const j = await r.json().catch(() => ({}));
                    if (!r.ok) throw new Error(j.error || "添加失败");
                    toast.success("已添加，需求和需求文档里都能看到");
                    setUi(null);
                    await after(true);
                  } catch (err) {
                    toast.error((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <input className="input" aria-label="名称" placeholder="名称，如：会员中心 UI v1" value={ui.title} maxLength={100} onChange={(e) => setUi({ ...ui, title: e.target.value })} />
                <input className="input" aria-label="地址" placeholder="https://www.figma.com/design/…" value={ui.url} maxLength={1000} onChange={(e) => setUi({ ...ui, url: e.target.value })} />
                <button type="submit" className="btn-primary nv-head-btn" disabled={busy || !/^https?:\/\//.test(ui.url.trim())}>
                  添加
                </button>
                <button type="button" className="text-link is-quiet" onClick={() => setUi(null)}>
                  取消
                </button>
              </form>
            ) : (
              <div className="nv-dl-barrow">
                <button type="button" className="btn-secondary nv-head-btn" onClick={() => setUi({ title: "", url: "" })}>
                  + 添加 UI 地址
                </button>
                <button type="button" className="btn-secondary nv-head-btn" onClick={() => setFigma(true)}>
                  用 Figma 设计
                </button>
              </div>
            )
          ) : (
            <p className="nv-dl-hint is-small">这篇文档还没关联需求：在页面顶部「所属需求」关联后才能挂 UI 设计稿。</p>
          )
        ) : null}
      </section>

      <section className="nv-ds-sec" aria-labelledby={`${fid}-r`}>
        <div className="nv-ds-head">
          <h3 id={`${fid}-r`}>AI 评审</h3>
          {ds?.review ? <span className={`nv-dl-tag${ds.review.verdict === "通过" ? " tone-success" : ds.review.verdict === "不通过" ? " tone-danger" : ""}`}>{ds.review.verdict || "已完成"}</span> : null}
          <span className="nv-dl-spacer" />
          {ds?.review ? (
            <a className="text-link" href={`/docs/${spaceId}/pages/${ds.review.id}`}>
              查看「{ds.review.title}」
            </a>
          ) : null}
        </div>
        <p className="nv-dl-hint is-small">按 PRD、原型和 UI 设计稿做需求验证：功能点有没有覆盖、是否矛盾、缺不缺异常和空状态，给出结论和问题清单（写成文档）。</p>
        {data.canEdit ? (
          <div className="nv-dl-barrow nv-ds-acts">
            <button type="button" className={ds?.review ? "btn-secondary nv-head-btn" : "btn-primary nv-head-btn"} disabled={busy || !pick} onClick={() => void act({ action: "aiReview", credentialId, model }, "已开始 AI 评审")}>
              {ds?.review ? "再评审一次" : "开始 AI 评审"}
            </button>
            {issues ? (
              <>
                {proto ? (
                  <button type="button" className="btn-secondary nv-head-btn" onClick={() => setForm({ mode: "modify", base: "current", note: `按 AI 评审意见修改原型：\n${issues.replace(/^AI 评审结论[^\n]*\n?/, "").replace(/\n\n完整报告见[\s\S]*$/, "")}` })}>
                    按意见改原型
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-secondary nv-head-btn"
                  onClick={async () => {
                    const text = `按 AI 评审意见修改 PRD：\n${issues.replace(/^AI 评审结论[^\n]*\n?/, "").replace(/\n\n完整报告见[\s\S]*$/, "")}`;
                    if (d.prdStatus === "confirmed") {
                      if (!(await confirm({ title: "重新打开 PRD？", body: "改 PRD 要先重新打开，改完再确认。已生成的用例会提示「依据已变更」。", confirmLabel: "重新打开并修改" }))) return;
                      if (!(await act({ action: "reopen", stage: "prd" }))) return;
                    }
                    editPrd(text);
                  }}
                >
                  按意见改 PRD
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <button type="button" className="btn-primary nv-dl-go" onClick={() => goStage("cases")}>
        设计完成，去生成测试用例
      </button>

      <Modal open={figma} onClose={() => setFigma(false)} title="用 Figma 设计">
        <div className="nv-pform">
          <div className="nv-pform-body">
            <p className="nv-pform-intro">把下面这段交给接了 Figma 的本机 Agent（如 Claude Code + Figma 连接器，并在「设置 · 本机 Agent」接入小围空间）。它会读 PRD 和原型、在 Figma 里画，画完自动把 UI 地址写回需求，需求页和需求文档里会显示。</p>
            <textarea className="input nv-set-textarea nv-ds-prompt" rows={9} readOnly value={figmaPrompt} aria-label="给 Agent 的指令" />
          </div>
          <div className="nv-pform-foot">
            <span className="nv-pform-note" />
            <ModalCancelButton className="btn-secondary nv-head-btn">关闭</ModalCancelButton>
            <button
              type="button"
              className="btn-primary nv-head-btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(figmaPrompt);
                  toast.success("已复制");
                } catch {
                  toast.error("复制失败，请手动选中复制");
                }
              }}
            >
              复制指令
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** T58 用例确认后的完结点：等开发完成再测试 */
function DevStage({ data, goTest }: { data: Data; goTest: () => void }) {
  const dev = data.reqs || data.tests?.dev;
  if (!dev) return <p className="nv-dl-empty">先确认 PRD。</p>;
  const casesOk = data.delivery?.casesStatus === "confirmed";
  // 项目要求评审等情况下，拆出的需求可能还停在需求阶段，没进「待开发」
  const notStarted = !dev.ready && dev.items.length > 0 && dev.items.every((x) => x.status.startsWith("req"));
  return (
    <div className="nv-dl-body">
      <div className={`nv-ds-dev${dev.ready ? " is-ready" : ""}`}>
        <p className="nv-ds-dev-title">{dev.ready ? (casesOk ? "开发完成，可以开始测试" : "开发完成，确认测试用例后就能测试") : notStarted ? "PRD 已确认，需求还没进入开发" : "PRD 已确认，实现需求开发中"}</p>
        <p className="nv-dl-hint is-small">{dev.ready ? (casesOk ? "进入「测试」发起正式测试；跑完确认结果后自动生成测试报告。" : "到「用例」生成并确认测试用例，再发起测试。") : notStarted ? "需求还在需求阶段：项目开启了需求评审时要先评审通过，或者在看板上改到「待开发」。开发和写测试用例可以同时进行。" : "开发和写测试用例可以同时进行。需求开发完成（进入「开发完成」或「待测试」）后才能发起正式测试；开发期间可以在用例页「试跑」单条用例。"}</p>
        {dev.items.length ? (
          <ul className="nv-ds-list">
            {dev.items.map((x) => (
              <li key={x.id}>
                <a className="text-link" href={`/requirements/${x.id}`}>
                  {x.code}
                </a>
                <span className="nv-ds-req">{x.title}</span>
                <span className={`nv-dl-tag${x.done ? " tone-success" : ""}`}>{x.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nv-dl-hint is-small">这份交付还没有关联需求，不限制测试。</p>
        )}
      </div>
      {dev.ready && casesOk ? (
        <button type="button" className="btn-primary nv-dl-go" onClick={goTest}>
          去测试
        </button>
      ) : null}
    </div>
  );
}

/** 11-23 上线：关联需求加入发版、标记上线后打勾（实现需求全部上线时业务需求自动上线） */
function OnlineStage({ data }: { data: Data }) {
  const rq = data.reqs;
  if (!rq) return <p className="nv-dl-empty">先确认 PRD。</p>;
  const all = rq.online.total > 0 && rq.online.done === rq.online.total;
  return (
    <div className="nv-dl-body">
      <div className={`nv-ds-dev${all ? " is-ready" : ""}`}>
        <p className="nv-ds-dev-title">{all ? "全部已上线" : rq.online.total ? `已上线 ${rq.online.done} / ${rq.online.total}` : "这份交付还没有关联需求"}</p>
        <p className="nv-dl-hint is-small">{all ? "这次需求交付已经走完。" : "测试通过后，把需求加入发版并标记上线；实现需求全部上线后，业务需求会自动变成「已上线」。"}</p>
        {rq.items.length ? (
          <ul className="nv-ds-list">
            {rq.items.map((x) => (
              <li key={x.id}>
                <a className="text-link" href={`/requirements/${x.id}`}>
                  {x.code}
                </a>
                <span className="nv-ds-req">{x.title}</span>
                <span className={`nv-dl-tag${x.online ? " tone-success" : ""}`}>{x.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {!all && rq.online.total ? (
        <a className="btn-primary nv-dl-go" href={`/projects/${rq.projectId}/releases`}>
          去发版
        </a>
      ) : null}
    </div>
  );
}

function Stepper({ data, current, onPick }: { data: Data | null; current: View; onPick: (s: View) => void }) {
  const d = data?.delivery;
  const prd = d?.prdStatus || "none";
  const cases = d?.casesStatus || "none";
  const t = data?.tests;
  const hasProtoArt = !!data?.design?.artifacts.some((a) => a.kind === "prototype");
  const hasUi = !!data?.design?.artifacts.some((a) => a.kind === "ui");
  const TEST_STATE: Record<string, string> = { none: "未开始", running: "测试中", fixing: "待修复", retest: "待回归", passed: "测试通过" };
  const rq = data?.reqs;
  const devTotal = rq?.devCount.total ?? 0;
  const devDone = rq?.devCount.done ?? 0;
  const latestReport = t?.rounds[0]?.reportPageId;
  const steps = [
    { key: "prd" as const, label: "PRD", sub: prd === "confirmed" ? `已确认 v${d?.prdConfirmedVersion}` : PRD_STATUS[prd], done: prd === "confirmed", enabled: true },
    // 11-23：只有真正有原型（本交付生成的，或需求上挂了原型资料）才算完成；只挂了 UI 稿不打勾
    { key: "design" as const, label: "原型设计", sub: d?.protoStatus === "generating" ? "生成原型中" : d?.reviewStatus === "generating" ? "AI 评审中" : data?.design?.prototype ? `原型 v${data.design.prototype.version}` : hasProtoArt ? (hasUi ? "有原型和 UI 稿" : "有原型") : hasUi ? "有 UI 稿 · 原型未做" : prd === "confirmed" ? "未开始" : "等 PRD", done: !!data?.design?.prototype || hasProtoArt, enabled: prd === "confirmed" || d?.protoStatus === "generating" },
    { key: "cases" as const, label: "用例", sub: prd !== "confirmed" && cases === "none" ? "待开始" : d?.casesStale ? "依据已变更" : PRD_STATUS[cases], done: cases === "confirmed" && !d?.casesStale, enabled: prd === "confirmed" || cases !== "none" },
    // 11-23 按实际流程：PRD 确认后实现需求就进「待开发」，开发和写用例并行；测试要最近一轮通过、报告要真的生成了才打勾；最后是上线
    { key: "dev" as const, label: "开发", sub: prd !== "confirmed" ? "等 PRD" : !rq?.items.length ? "未关联需求" : rq.ready ? "开发完成" : `完成 ${devDone}/${devTotal}`, done: prd === "confirmed" && !!rq?.ready, enabled: prd === "confirmed" },
    { key: "test" as const, label: "测试", sub: cases !== "confirmed" ? "等用例确认" : t?.active ? `第 ${t.active.round} 轮 · ${t.active.status === "queued" ? "排队" : t.active.status === "running" ? "执行中" : "待完成"}` : t?.rounds.length ? TEST_STATE[t.state] || `${t.rounds.length} 轮` : rq && !rq.ready ? "等开发" : "未开始", done: t?.state === "passed", enabled: cases === "confirmed" },
    { key: "report" as const, label: "报告", sub: latestReport ? "已生成" : t?.rounds.length ? "待生成" : "等测试完成", done: !!latestReport, enabled: !!t?.rounds.length },
    { key: "online" as const, label: "上线", sub: !rq?.online.total ? (prd === "confirmed" ? "未关联需求" : "等 PRD") : rq.online.done === rq.online.total ? "已上线" : `已上线 ${rq.online.done}/${rq.online.total}`, done: !!rq?.online.total && rq.online.done === rq.online.total, enabled: prd === "confirmed" },
  ];
  return (
    <ol className="nv-dl-steps">
      {steps.map((s) => (
        <li key={s.key}>
          <button type="button" className="nv-dl-step" aria-current={current === s.key ? "step" : undefined} data-done={s.done || undefined} disabled={!s.enabled} onClick={() => onPick(s.key)}>
            <span className="nv-dl-step-top">
              {s.done ? <Check size={12} aria-hidden="true" /> : <span className="nv-dl-dot" aria-hidden="true" />}
              {s.label}
            </span>
            <span className="nv-dl-step-sub">{s.sub}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

type StageProps = {
  data: Data;
  spaceId: string;
  skills: SkillOpt[];
  models: ModelOpt[] | null;
  pick: string;
  setPick: (v: string) => void;
  credentialId: string;
  model: string;
  after: (refresh?: boolean) => Promise<void>;
};

function ModelSelect({ models, pick, setPick, id, compact }: { models: ModelOpt[] | null; pick: string; setPick: (v: string) => void; id: string; compact?: boolean }) {
  return (
    <select id={id} className={`input${compact ? " nv-dl-model-mini" : ""}`} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="模型">
      {!models?.length ? <option value="">{models ? "还没有模型（设置 · 模型管理）" : "正在加载模型…"}</option> : null}
      {(models || []).map((o) => (
        <option key={`${o.credentialId}|${o.model}`} value={`${o.credentialId}|${o.model}`} disabled={o.disabled}>
          {o.label}
          {o.disabled ? "（token 不足）" : ""}
        </option>
      ))}
    </select>
  );
}

function GenerateForm({ kind, defaultSkill, skills, models, pick, setPick, sourceNote, onStart }: { kind: Stage; defaultSkill: string; skills: SkillOpt[]; models: ModelOpt[] | null; pick: string; setPick: (v: string) => void; sourceNote: string; onStart: (skillId: string, note: string, files?: { name: string; data: string }[]) => Promise<void>; }) {
  const id = useId();
  const [skill, setSkill] = useState(defaultSkill);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<{ name: string; data: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const toastF = useToast();
  return (
    <form
      className="nv-dl-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onStart(skill, note, files).finally(() => setBusy(false));
      }}
    >
      <p className="nv-dl-form-title">{kind === "prd" ? "第 1 步 · 生成 PRD" : "第 2 步 · 生成测试用例和脚本"}</p>
      <p className="nv-dl-hint">
        {kind === "prd" ? "把本页的纪要或基础需求整理成开发、测试能直接用的 PRD。PRD 是本页的子页面，原文不会被改动。" : "按已确认的 PRD 生成测试用例，每条可自动执行的用例带结构化的脚本步骤。用例是原始文档的子页面。"}
      </p>
      <label className="nv-set-field" htmlFor={`${id}-s`}>
        用哪个能力
        <select id={`${id}-s`} className="input" value={skill} onChange={(e) => setSkill(e.target.value)}>
          {skills.length ? null : <option value={defaultSkill}>{kind === "prd" ? "内置 · PRD 生成" : "内置 · 测试用例生成"}</option>}
          {skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.builtin ? "内置" : "我的能力"} · {s.name}
            </option>
          ))}
        </select>
        <small>「我的能力」里上传的 skill（如 caffrey-prd-plus）也可以选</small>
      </label>
      <label className="nv-set-field" htmlFor={`${id}-m`}>
        模型
        <ModelSelect id={`${id}-m`} models={models} pick={pick} setPick={setPick} />
      </label>
      <label className="nv-set-field" htmlFor={`${id}-n`}>
        补充说明（可选）
        <textarea id={`${id}-n`} className="input nv-set-textarea" rows={3} maxLength={2000} value={note} placeholder={kind === "prd" ? "例如：只做 Web 端；扫码过期时间按 2 分钟写" : "例如：重点覆盖权限和异常；测试账号是管理员"} onChange={(e) => setNote(e.target.value)} />
      </label>
      {kind === "prd" ? (
        <div className="nv-set-field">
          附加材料（可选）
          <label className="btn-secondary nv-head-btn nv-dl-files">
            选择文件
            <input
              type="file"
              multiple
              accept=".txt,.md,.markdown,.csv,.docx"
              className="sr-only"
              aria-label="附加材料"
              onChange={async (e) => {
                const picked = Array.from(e.target.files || []);
                e.target.value = "";
                if (picked.length + files.length > 3) return toastF.error("最多附加 3 个文件");
                for (const f of picked) {
                  if (f.size > 2 * 1024 * 1024) return toastF.error(`「${f.name}」超过 2 MB`);
                  if (!/\.(txt|md|markdown|csv|docx)$/i.test(f.name)) return toastF.error(`「${f.name}」格式不支持：只能是 txt / md / csv / docx`);
                }
                const read = await Promise.all(picked.map((f) => new Promise<{ name: string; data: string }>((res, rej) => { const fr = new FileReader(); fr.onload = () => res({ name: f.name, data: String(fr.result).replace(/^data:[^,]*,/, "") }); fr.onerror = () => rej(new Error("读取失败")); fr.readAsDataURL(f); }))).catch(() => null);
                if (read) setFiles((x) => [...x, ...read]);
              }}
            />
          </label>
          {files.length ? (
            <ul className="nv-dl-filelist">
              {files.map((f) => (
                <li key={f.name}>
                  {f.name}
                  <button type="button" className="text-link is-quiet" onClick={() => setFiles((x) => x.filter((y) => y !== f))}>
                    移除
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <small>会议纪要、录音转写等：txt / md / csv / docx，最多 3 个，每个 ≤ 2 MB；PDF 请先另存为 Word</small>
        </div>
      ) : null}
      <p className="nv-dl-source">{sourceNote}</p>
      <button type="submit" className="btn-primary nv-dl-go" disabled={busy || !pick}>
        <Sparkles size={14} aria-hidden="true" />
        {busy ? "正在提交…" : kind === "prd" ? "生成 PRD" : "生成测试用例"}
      </button>
      <p className="nv-dl-hint is-small">在后台生成，大约 1～2 分钟，可以离开本页，完成后铃铛里会通知你。</p>
    </form>
  );
}

/** 生成进度（T29，Figma 78）：阶段、字数、最近更新、正文预览；45 秒没有新内容提示可能卡住，可以停止 */
const STALL_MS = 45_000;
const n = (v: number) => v.toLocaleString("zh-CN");
const dur = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
};
/** 预览里最后一个小节标题（Markdown 二、三级标题） */
function sectionOf(text: string) {
  const all = [...String(text || "").matchAll(/^#{2,3}\s+(.+)$/gm)];
  return all.length ? all[all.length - 1][1].replace(/[*`]/g, "").trim().slice(0, 40) : "";
}

function Generating({ what, request, progress, onStop }: { what: string; request: string; progress: Progress | null; onStop: () => Promise<void> }) {
  const [stopping, setStopping] = useState(false);
  const [showThink, setShowThink] = useState(false);
  const p = progress;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [p?.preview, p?.thinkChars]);
  const stalled = !!p && p.ageMs > STALL_MS && p.stage !== "save";
  const ago = p ? (p.ageMs < 3000 ? "刚刚更新" : `${dur(p.ageMs)}前更新`) : "";
  // 思考用了多久：从开始思考到开始写正文（还在思考就到现在）
  const thinkMs = p?.thinkStartedAt ? (p.writeStartedAt ? new Date(p.writeStartedAt).getTime() : Date.now() - p.ageMs) - new Date(p.thinkStartedAt).getTime() : 0;
  const thinking = p?.stage === "think" || (p?.stage === "connect" && !p.textChars);
  const status = !p || p.stage === "prepare" ? "正在整理材料…" : p.stage === "connect" ? `正在连接 ${p.model}…` : p.stage === "think" ? "正在思考…" : p.stage === "write" ? `正在写${what} · 已写 ${n(p.textChars)} 字` : "正在整理排版、写入文档…";
  return (
    <div className="nv-dl-chat nv-dl-gen" aria-live="polite">
      <div className="nv-dl-msg is-me">
        <p>{request}</p>
      </div>
      <div className="nv-dl-msg is-ai is-stream">
        <span className="nv-dl-who">小围</span>
        {p && p.thinkChars ? (
          <div className="nv-dl-think">
            <button type="button" className="nv-dl-think-head" aria-expanded={showThink} onClick={() => setShowThink((v) => !v)}>
              {thinking ? <Loader2 size={12} className="nv-spin" aria-hidden="true" /> : <ChevronRight size={12} className={showThink ? "is-open" : ""} aria-hidden="true" />}
              {thinking ? "思考中" : "已思考"}
              {thinkMs > 0 ? ` ${dur(thinkMs)}` : ""} · {n(p.thinkChars)} 字
            </button>
            {showThink || thinking ? <p className="nv-dl-think-body">{(p.thinkPreview || "").length >= 600 ? "…" : ""}{p.thinkPreview}</p> : null}
          </div>
        ) : null}
        {p?.preview ? (
          // T53：正文实时显示在左侧文档区，这里只说写到哪了
          <p className="nv-dl-writing">
            {p.stage === "write" && !stalled ? <Loader2 size={12} className="nv-spin" aria-hidden="true" /> : null}
            {p.stage === "save" ? "写完了，正在排版、写入文档…" : `正在写${sectionOf(p.preview) ? `：${sectionOf(p.preview)}` : what} · 已写 ${n(p.textChars)} 字`}
            <span className="nv-dl-writing-sub">内容实时显示在左侧</span>
          </p>
        ) : !p || !p.thinkChars ? (
          <p className="nv-dl-typing">
            <Loader2 size={14} className="nv-spin" aria-hidden="true" />
            {status}
          </p>
        ) : null}
        {p?.note ? <p className="nv-dl-hint is-small">{p.note}</p> : null}
        {stalled ? <p className="nv-dl-stall">模型 {dur(p!.ageMs)}没有返回新内容，可能卡住了。可以再等等（超过 3 分钟会自动停止），或者停止后换个模型重试。</p> : null}
        <div className="nv-dl-gen-foot">
          <span>
            {[status, p ? (stalled ? `${dur(p.ageMs)}没有新内容` : ago) : "", p ? `用时 ${dur(p.elapsedMs)}` : ""].filter(Boolean).join(" · ")}
          </span>
          <button
            type="button"
            className="btn-secondary nv-head-btn"
            disabled={stopping}
            onClick={async () => {
              setStopping(true);
              try {
                await onStop();
              } finally {
                setStopping(false);
              }
            }}
          >
            {stopping ? "正在停止…" : "停止"}
          </button>
        </div>
      </div>
      <p className="nv-dl-hint is-small nv-dl-gen-leave">可以离开本页，完成后铃铛里会通知你</p>
      <div ref={end} />
    </div>
  );
}

function PrdStage({ data, spaceId, pageId, skills, models, pick, setPick, credentialId, model, after, prefill = "" }: StageProps & { pageId: string; prefill?: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [ask, setAsk] = useState(false);
  const [split, setSplit] = useState(true);
  const d = data.delivery;
  const st = d?.prdStatus || "none";
  const base = `/docs/${spaceId}/pages`;

  const start = async (skillId: string, note: string, files?: { name: string; data: string }[]) => {
    try {
      await post("/api/deliveries", { pageId: data.source?.id || pageId, skillId, credentialId, model, note, files });
      await after(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const act = async (body: Record<string, unknown>, ok?: string) => {
    try {
      await post(`/api/deliveries/${d!.id}`, body);
      if (ok) toast.success(ok);
      await after();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!data.canEdit && !d) return <p className="nv-dl-empty">这篇文档还没有开始需求交付。有文档编辑权限的人可以在这里生成 PRD。</p>;
  if (!d || st === "none" || st === "failed")
    return (
      <div className="nv-dl-body">
        {d?.error ? <p className="nv-dl-error">{d.error}</p> : null}
        {data.canEdit ? (
          data.canStart ? (
            <GenerateForm kind="prd" defaultSkill={d?.prdSkillId || "builtin:prd"} skills={skills} models={models} pick={pick} setPick={setPick} sourceNote={`依据：「${data.source?.title || ""}」正文，约 ${(data.source?.chars || 0).toLocaleString()} 字`} onStart={start} />
          ) : (
            <p className="nv-dl-empty">只有文字页面可以生成 PRD。</p>
          )
        ) : (
          <p className="nv-dl-empty">没有编辑权限。</p>
        )}
        <p className="nv-dl-empty">生成 PRD 后，可以在这里和小围对话修改。</p>
      </div>
    );
  if (st === "generating")
    return <Generating what=" PRD" request={`生成 PRD · ${skills.find((x) => x.id === d?.prdSkillId)?.name || "PRD 生成"} · ${d?.model || ""}`} progress={d?.progress || null} onStop={() => act({ action: "stopGenerate", what: "prd" }, "已停止生成")} />;
  const prd = data.prd;
  const qs = prd?.openQuestions || [];
  return (
    <>
      <div className="nv-dl-bar">
        {d.error ? <p className="nv-dl-error">{d.error}</p> : null}
        <div className="nv-dl-barrow">
          {prd && data.role !== "prd" ? (
            <Link className="text-link" href={`${base}/${prd.id}`}>
              打开 PRD <ChevronRight size={12} aria-hidden="true" />
            </Link>
          ) : (
            <span className="nv-dl-meta">{st === "confirmed" ? `已确认第 ${d.prdConfirmedVersion} 版` : `草稿 · 第 ${prd?.version ?? 0} 版${qs.length ? ` · 待确认 ${qs.length}` : ""}`}</span>
          )}
          <span className="nv-dl-spacer" />
          {data.canEdit && st === "draft" ? (
            <>
              <button
                type="button"
                className="btn-secondary nv-head-btn"
                onClick={async () => {
                  if (await confirm({ title: "重新生成 PRD？", body: "会按原始文档重新生成一份，发布成新的一版。现在的内容留在版本记录里，可以恢复。", confirmLabel: "重新生成" })) await start(d.prdSkillId || "builtin:prd", "");
                }}
              >
                重新生成
              </button>
              <button type="button" className="btn-primary nv-head-btn" onClick={() => setAsk(true)}>
                确认 PRD
              </button>
            </>
          ) : null}
          {data.canEdit && st === "confirmed" ? (
            <button
              type="button"
              className="btn-secondary nv-head-btn"
              onClick={async () => {
                if (await confirm({ title: "重新打开 PRD？", body: "重新打开后可以继续修改。再次确认后，已生成的测试用例会提示「依据已变更」。", confirmLabel: "重新打开" })) await act({ action: "reopen", stage: "prd" }, "已重新打开");
              }}
            >
              重新打开
            </button>
          ) : null}
        </div>
      </div>
      <Chat key={prefill} initialText={prefill} stage="prd" data={data} models={models} pick={pick} setPick={setPick} credentialId={credentialId} model={model} after={after} readOnly={!data.canEdit} locked={st === "confirmed"} placeholder="说说要怎么改，比如：解绑后会话立即失效" />
      <Modal open={ask} onClose={() => setAsk(false)} title="确认 PRD？">
        <div className="nv-dl-confirm">
          <p>确认后当前第 {prd?.version} 版会锁定，测试可以基于它生成用例。之后要改，需要先「重新打开」，已生成的用例会提示「依据已变更」。</p>
          {prd?.hasDraft ? <p className="nv-dl-error">PRD 有未发布的草稿，先在编辑页发布或放弃草稿再确认。</p> : null}
          {qs.length ? (
            <div className="nv-dl-warn">
              <p>还有 {qs.length} 个待确认问题没有回答</p>
              <ul>
                {qs.slice(0, 5).map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="nv-pform-foot">
          <label className="nv-pform-note nv-dl-split-ck">
            <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
            同时把功能清单拆成项目需求池里的需求{d.splitCount ? `（已拆 ${d.splitCount} 个，不重复建）` : ""}
          </label>
          <ModalCancelButton className="btn-secondary nv-head-btn">{qs.length ? "回去回答" : "取消"}</ModalCancelButton>
          <button
            type="button"
            className="btn-primary nv-head-btn"
            disabled={prd?.hasDraft}
            onClick={async () => {
              setAsk(false);
              try {
                const r = await post(`/api/deliveries/${d!.id}`, { action: "confirm", stage: "prd", split });
                if (r.split?.error) toast.error(`PRD 已确认，但拆需求没完成：${r.split.error}`);
                else toast.success(r.split ? `PRD 已确认，拆出 ${r.split.created} 条需求${r.split.skipped ? `（${r.split.skipped} 条已存在）` : ""}` : "PRD 已确认");
                await after();
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            {qs.length ? "仍然确认" : "确认"}
          </button>
        </div>
      </Modal>
    </>
  );
}

function CasesStage({ data, spaceId, skills, models, pick, setPick, credentialId, model, after }: StageProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const d = data.delivery!;
  const st = d?.casesStatus || "none";
  const base = `/docs/${spaceId}/pages`;
  const act = async (body: Record<string, unknown>, ok?: string) => {
    try {
      await post(`/api/deliveries/${d.id}`, body);
      if (ok) toast.success(ok);
      await after(body.action !== "cases");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  if (!d) return null;
  if (st === "generating")
    return <Generating what="测试用例" request={`生成测试用例 · ${skills.find((x) => x.id === d.casesSkillId)?.name || "测试用例"} · ${d.model || ""}`} progress={d.progress || null} onStop={() => act({ action: "stopGenerate", what: "cases" }, "已停止生成")} />;
  if (st === "none") {
    if (d.prdStatus !== "confirmed") return <p className="nv-dl-empty">先确认 PRD，再生成测试用例。</p>;
    return (
      <div className="nv-dl-body">
        {d.error ? <p className="nv-dl-error">{d.error}</p> : null}
        {data.canEdit ? (
          <GenerateForm kind="cases" defaultSkill={d.casesSkillId || "builtin:test-cases"} skills={skills} models={models} pick={pick} setPick={setPick} sourceNote={`依据：「${data.prd?.title || "PRD"}」第 ${d.prdConfirmedVersion} 版（已确认）`} onStart={(skillId, note) => act({ action: "cases", skillId, credentialId, model, note })} />
        ) : (
          <p className="nv-dl-empty">没有编辑权限。</p>
        )}
      </div>
    );
  }
  const c = data.cases;
  const cov = c?.coverage;
  return (
    <>
      <div className="nv-dl-bar">
        {d.error ? <p className="nv-dl-error">{d.error}</p> : null}
        {d.casesStale ? <p className="nv-dl-warn-line">PRD 已改成第 {d.prdConfirmedVersion} 版，用例依据的是旧版：可以让小围只更新受影响的用例，或重新生成。</p> : null}
        {cov && cov.missing.length ? <p className="nv-dl-warn-line">覆盖 {cov.covered} / {cov.total} 个功能点，{cov.missing.join("、")} 还没有用例</p> : null}
        <div className="nv-dl-barrow">
          {c && data.role !== "cases" ? (
            <Link className="text-link" href={`${base}/${c.id}`}>
              打开用例（{c.summary.total} 条） <ChevronRight size={12} aria-hidden="true" />
            </Link>
          ) : (
            <span className="nv-dl-meta">{c ? `${c.summary.total} 条 · 自动 ${c.summary.auto} · 手工 ${c.summary.manual}` : ""}</span>
          )}
          <span className="nv-dl-spacer" />
          {data.canEdit && st === "draft" ? (
            <>
              {d.prdStatus === "confirmed" ? (
                <button
                  type="button"
                  className="btn-secondary nv-head-btn"
                  onClick={async () => {
                    if (await confirm({ title: "重新生成测试用例？", body: "会按已确认的 PRD 重新生成，发布成新的一版。现在的用例留在版本记录里，可以恢复。", confirmLabel: "重新生成" })) await act({ action: "cases", skillId: d.casesSkillId || "builtin:test-cases", credentialId, model });
                  }}
                >
                  重新生成
                </button>
              ) : null}
              <button
                type="button"
                className="btn-primary nv-head-btn"
                onClick={async () => {
                  if (await confirm({ title: "确认测试用例？", body: cov && cov.missing.length ? `还有 ${cov.missing.join("、")} 没有用例。确认后用例会锁定，之后要改需要先「重新打开」。` : "确认后用例会锁定，之后要改需要先「重新打开」。确认后就可以发起测试。", confirmLabel: "确认用例" })) await act({ action: "confirm", stage: "cases" }, "用例已确认");
                }}
              >
                确认用例
              </button>
            </>
          ) : null}
          {data.canEdit && st === "confirmed" ? (
            <button
              type="button"
              className="btn-secondary nv-head-btn"
              onClick={async () => {
                if (await confirm({ title: "重新打开测试用例？", body: "重新打开后可以继续修改，改完再确认。", confirmLabel: "重新打开" })) await act({ action: "reopen", stage: "cases" }, "已重新打开");
              }}
            >
              重新打开
            </button>
          ) : null}
        </div>
      </div>
      <Chat stage="cases" data={data} models={models} pick={pick} setPick={setPick} credentialId={credentialId} model={model} after={after} readOnly={!data.canEdit} locked={st === "confirmed"} placeholder="比如：TC-07 删掉；补充网络断开的异常用例" />
    </>
  );
}

function Chat({ stage, data, models, pick, setPick, credentialId, model, after, readOnly, locked, placeholder, initialText = "" }: { stage: Stage; data: Data; models: ModelOpt[] | null; pick: string; setPick: (v: string) => void; credentialId: string; model: string; after: (refresh?: boolean) => Promise<void>; readOnly: boolean; locked: boolean; placeholder: string; initialText?: string }) {
  const toast = useToast();
  const id = useId();
  const [text, setText] = useState(initialText);
  const [sending, setSending] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const deliveryId = data.delivery?.id || "";
  // T53：回复流式显示（服务端边收边放内存，这里轮询）
  useEffect(() => {
    if (!sending || !deliveryId) return;
    let alive = true;
    let timer = 0;
    const tick = async () => {
      try {
        const r = await fetch(`/api/deliveries/${deliveryId}/live?what=chat`, { cache: "no-store" });
        const j = (await r.json()) as { active?: boolean; text?: string };
        if (alive && j.active && j.text) setStreamText(j.text);
      } catch {
        /* 下次再取 */
      }
      if (alive) timer = window.setTimeout(() => void tick(), 700);
    };
    timer = window.setTimeout(() => void tick(), 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      setStreamText("");
    };
  }, [sending, deliveryId]);
  const msgs = (data.messages || []).filter((m) => m.stage === stage);
  const d = data.delivery!;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs.length, sending, streamText]);

  // T52：在 PRD 页上，待确认的修改显示在正文里（修订标记），对话里只留条目
  const inDoc = stage === "prd" && data.role === "prd" && !locked;
  const prdId = data.prd?.id ?? "";
  const revNo = new Map<string, number>();
  if (inDoc) {
    let no = 0;
    for (const m of msgs) for (const s of m.suggestions) if (s.status === "pending" && (s.index ?? -1) >= 0) revNo.set(s.id, ++no);
  }
  const revKey = inDoc ? msgs.map((m) => m.suggestions.map((s) => `${s.id}:${s.status}:${s.index ?? ""}`).join(",")).join("|") : "";
  const actRef = useRef<(m: string, s: string, a: "apply" | "ignore" | "undo") => Promise<void>>(async () => {});
  useEffect(() => {
    if (!inDoc || !prdId) return;
    const items: Rev[] = [];
    let no = 0;
    for (const m of msgs)
      for (const s of m.suggestions)
        if (s.status === "pending" && (s.index ?? -1) >= 0) items.push({ messageId: m.id, id: s.id, no: ++no, title: s.title, op: s.op, index: s.index!, html: s.html || "" });
    setRevisions({ pageId: prdId, items, act: (mid, sid, op) => actRef.current(mid, sid, op), busy: null, readOnly });
    return () => setRevisions(null);
    // revKey 已包含 msgs 里和修订有关的全部变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revKey, inDoc, prdId, readOnly]);

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    if (!credentialId) return toast.error("请先选择模型（设置 · 模型管理里添加）");
    setSending(content);
    setText("");
    try {
      await post(`/api/deliveries/${d.id}`, { action: "message", stage, content, credentialId, model });
      await after(false);
    } catch (e) {
      setText(content);
      toast.error((e as Error).message);
    } finally {
      setSending(null);
    }
  };
  const onSugg = async (messageId: string, suggestionId: string, action: "apply" | "ignore" | "undo") => {
    setWorking(`${messageId}:${suggestionId}`);
    try {
      const r = await post(`/api/deliveries/${d.id}`, { action: "suggestion", messageId, suggestionId, op: action });
      if (action === "apply" && r.applied === 0) toast.error("没能应用：原文已经变了，可以让小围按最新内容重新给建议");
      else if (action === "apply") toast.success(suggestionId === "all" ? `已应用 ${r.applied} 条修改` : "已应用");
      else if (action === "undo") toast.success("已撤销");
      await after(action !== "ignore");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setWorking(null);
    }
  };
  useEffect(() => {
    actRef.current = onSugg;
  });

  return (
    <>
      <div className="nv-dl-chat" aria-live="polite">
        {msgs.length === 0 && !sending ? <p className="nv-dl-empty">有不确定或要调整的地方，直接告诉小围。</p> : null}
        {msgs.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="nv-dl-msg is-me">
              <p>{m.content}</p>
            </div>
          ) : (
            <div key={m.id} className="nv-dl-msg is-ai">
              <span className="nv-dl-who">小围</span>
              <p>{m.content}</p>
              {m.suggestions.map((s) =>
                inDoc && (s.status !== "pending" || revNo.has(s.id)) ? (
                  <RevRow key={s.id} s={s} no={revNo.get(s.id)} busy={readOnly || working === `${m.id}:${s.id}` || working === `${m.id}:all`} onUndo={() => void onSugg(m.id, s.id, "undo")} />
                ) : (
                  <SuggCard key={s.id} s={s} busy={working === `${m.id}:${s.id}` || working === `${m.id}:all`} disabled={readOnly || (locked && s.status !== "applied")} locked={locked} onAct={(a) => void onSugg(m.id, s.id, a)} />
                ),
              )}
              {inDoc && m.suggestions.some((s) => revNo.has(s.id)) ? <p className="nv-dl-hint is-small">{readOnly ? "修改已标在左侧正文里，点条目跳过去查看；有编辑权限的人可以接受或拒绝。" : "修改已标在左侧正文里，点条目跳过去，逐处或一次接受。"}</p> : null}
              {!inDoc && !readOnly && !locked && m.suggestions.filter((s) => s.status === "pending").length > 1 ? (
                <div className="nv-dl-all">
                  <button type="button" className="text-link" disabled={!!working} onClick={() => void onSugg(m.id, "all", "apply")}>
                    全部应用（{m.suggestions.filter((s) => s.status === "pending").length}）
                  </button>
                  <button type="button" className="text-link is-quiet" disabled={!!working} onClick={() => void onSugg(m.id, "all", "ignore")}>
                    全部忽略
                  </button>
                </div>
              ) : null}
            </div>
          ),
        )}
        {sending ? (
          <>
            <div className="nv-dl-msg is-me">
              <p>{sending}</p>
            </div>
            <div className="nv-dl-msg is-ai" role="status">
              <span className="nv-dl-who">小围</span>
              {streamText ? (
                <p className="nv-dl-stream">
                  {streamText}
                  <span className="nv-dl-caret" aria-hidden="true">▍</span>
                </p>
              ) : (
                <p className="nv-dl-typing">
                  <Loader2 size={14} className="nv-spin" aria-hidden="true" /> 正在想…
                </p>
              )}
            </div>
          </>
        ) : null}
        <div ref={end} />
      </div>
      {readOnly ? null : (
        <form
          className="nv-dl-input"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {locked ? <p className="nv-dl-hint is-small">{stage === "prd" ? "PRD" : "用例"}已确认：可以继续提问，要改内容先「重新打开」。</p> : null}
          <div className="nv-dl-inputbox">
            <label htmlFor={`${id}-t`} className="sr-only">
              给小围的消息
            </label>
            <textarea
              id={`${id}-t`}
              rows={2}
              value={text}
              maxLength={4000}
              placeholder={placeholder}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button type="submit" className="btn-primary nv-head-btn" disabled={!text.trim() || !!sending} aria-label="发送">
              <Send size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="nv-dl-inputfoot">
            <ModelSelect id={`${id}-m`} models={models} pick={pick} setPick={setPick} compact />
            <span>对话记录跟随本页保存，能看本页的人都能看到</span>
          </div>
        </form>
      )}
    </>
  );
}

/** T52：PRD 页上的修改条目（修订在正文里显示）：点击跳到正文；已应用的可以撤销 */
function RevRow({ s, no, busy, onUndo }: { s: Sugg; no?: number; busy: boolean; onUndo: () => void }) {
  const tagCls = s.status === "applied" ? "nv-dl-tag tone-success" : s.status === "failed" ? "nv-dl-tag tone-danger" : "nv-dl-tag";
  const label = s.status === "pending" ? "待确认" : s.status === "applied" ? "已接受" : s.status === "ignored" ? "已拒绝" : s.status === "undone" ? "已撤销" : "没能应用";
  return (
    <div className="nv-dl-revrow" data-status={s.status}>
      {s.status === "pending" ? (
        <button type="button" className="nv-dl-revlink" onClick={() => scrollToRev(s.id)}>
          <span className="nv-dl-revno">修订 {no}</span>
          <span className="nv-dl-revtitle">{s.title}</span>
        </button>
      ) : (
        <span className="nv-dl-revlink is-static">
          <span className="nv-dl-revtitle">{s.title}</span>
        </span>
      )}
      <span className={tagCls}>{label}</span>
      {s.status === "applied" ? (
        <button type="button" className="text-link" disabled={busy} onClick={onUndo}>
          撤销
        </button>
      ) : null}
    </div>
  );
}

function SuggCard({ s, busy, disabled, locked, onAct }: { s: Sugg; busy: boolean; disabled: boolean; locked: boolean; onAct: (a: "apply" | "ignore" | "undo") => void }) {
  return (
    <div className="nv-dl-sugg" data-status={s.status}>
      <div className="nv-dl-sugg-head">
        <span>修改建议 · {s.title}</span>
        {s.status === "applied" ? <span className="nv-dl-tag tone-success">已应用</span> : s.status === "ignored" ? <span className="nv-dl-tag">已忽略</span> : s.status === "undone" ? <span className="nv-dl-tag">已撤销</span> : s.status === "failed" ? <span className="nv-dl-tag tone-danger">没能应用</span> : null}
      </div>
      {s.op !== "add" && s.op !== "insert_after" ? <pre className="nv-dl-before">{s.before}</pre> : <p className="nv-dl-hint is-small">{s.before}</p>}
      {s.op !== "delete" ? <pre className="nv-dl-after">{s.after}</pre> : <p className="nv-dl-hint is-small">删除这一块</p>}
      {s.error ? <p className="nv-dl-error">{s.error}</p> : null}
      {s.status === "pending" && !disabled ? (
        <div className="nv-dl-sugg-foot">
          <button type="button" className="btn-primary nv-head-btn" disabled={busy} onClick={() => onAct("apply")}>
            {busy ? "应用中…" : "应用"}
          </button>
          <button type="button" className="btn-secondary nv-head-btn" disabled={busy} onClick={() => onAct("ignore")}>
            忽略
          </button>
        </div>
      ) : null}
      {s.status === "applied" && !locked && !disabled ? (
        <div className="nv-dl-sugg-foot">
          <button type="button" className="text-link" disabled={busy} onClick={() => onAct("undo")}>
            撤销
          </button>
        </div>
      ) : null}
    </div>
  );
}
