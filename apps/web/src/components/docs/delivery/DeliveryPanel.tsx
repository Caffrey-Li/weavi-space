"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Loader2, Maximize2, Minimize2, PanelRightClose, Send, Sparkles } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { refreshDocsTree } from "@/components/docs/DocsNav";
import { setPanelMode, type PanelMode } from "./panel-mode";
import { ReportStage, TestStage, testBusy, type Tests } from "./TestStages";

type Stage = "prd" | "cases";
type View = Stage | "test" | "report";
type Sugg = { id: string; title: string; op: string; status: "pending" | "applied" | "ignored" | "undone" | "failed"; before: string; after: string; error?: string };
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
  };
  role: "source" | "prd" | "cases";
  canEdit: boolean;
  canStart: boolean;
  source: { id: string; title: string; chars: number } | null;
  prd?: (PageRef & { openQuestions: string[]; features: string[] }) | null;
  cases?: (PageRef & { summary: { total: number; auto: number; manual: number }; coverage: { total: number; covered: number; missing: string[] } }) | null;
  messages?: Msg[];
  tests?: Tests | null;
};
type Progress = {
  what: "prd" | "cases";
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
      .then((d: { builtin?: SkillOpt[]; mine?: SkillOpt[] }) => setSkills([...(d.builtin || []), ...(d.mine || [])]))
      .catch(() => setSkills([]));
  }, []);

  // 默认模型：上次用的，否则第一个可用的
  const okModels = (models || []).filter((o) => !o.disabled).map((o) => `${o.credentialId}|${o.model}`);
  const lastModel = data?.delivery?.credentialId && data.delivery.model ? `${data.delivery.credentialId}|${data.delivery.model}` : "";
  const pick = chosen && okModels.includes(chosen) ? chosen : okModels.includes(lastModel) ? lastModel : okModels[0] || "";
  const setPick = setChosen;

  const d = data?.delivery;
  const generating = d?.prdStatus === "generating" || d?.casesStatus === "generating";
  const running = testBusy(data?.tests);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(t);
  }, [running, load]);
  const busy = generating;
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

  const tests = data?.tests;
  const current: View =
    stage ?? (tests?.active ? "test" : tests && tests.state !== "none" ? "report" : d?.casesStatus === "confirmed" ? "test" : data?.role === "cases" || d?.prdStatus === "confirmed" ? "cases" : "prd");
  const [credentialId, model] = pick.split("|");

  const after = useCallback(
    async (refresh = true) => {
      await load();
      if (refresh) router.refresh();
    },
    [load, router],
  );

  return (
    <aside className="nv-dl-panel" data-mode={mode} aria-label="需求交付">
      <div className="nv-dl-head">
        <div className="nv-dl-headrow">
          <h2>需求交付</h2>
          <button type="button" className="icon-button" onClick={() => setPanelMode(mode === "wide" ? "open" : "wide")} aria-label={mode === "wide" ? "还原面板宽度" : "展开面板"} title={mode === "wide" ? "还原" : "展开"}>
            {mode === "wide" ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
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
          <TestStage id={d.id} tests={tests} canEdit={data.canEdit} casesConfirmed={d.casesStatus === "confirmed"} reload={after} onFinalized={() => setStage("report")} />
        ) : current === "report" && d && tests ? (
          <ReportStage id={d.id} tests={tests} canEdit={data.canEdit} prdHref={data.prd ? `/docs/${spaceId}/pages/${data.prd.id}` : null} reload={after} toTest={() => setStage("test")} />
        ) : current === "prd" ? (
          <PrdStage data={data} spaceId={spaceId} pageId={pageId} skills={skills} models={models} pick={pick} setPick={setPick} credentialId={credentialId} model={model} after={after} />
        ) : (
          <CasesStage data={data} spaceId={spaceId} skills={skills} models={models} pick={pick} setPick={setPick} credentialId={credentialId} model={model} after={after} />
        )
      ) : null}
    </aside>
  );
}

function Stepper({ data, current, onPick }: { data: Data | null; current: View; onPick: (s: View) => void }) {
  const d = data?.delivery;
  const prd = d?.prdStatus || "none";
  const cases = d?.casesStatus || "none";
  const t = data?.tests;
  const TEST_STATE: Record<string, string> = { none: "等测试完成", running: "测试中", fixing: "待修复", retest: "待回归", passed: "测试通过" };
  const steps = [
    { key: "prd" as const, label: "PRD", sub: prd === "confirmed" ? `已确认 v${d?.prdConfirmedVersion}` : PRD_STATUS[prd], done: prd === "confirmed", enabled: true },
    { key: "cases" as const, label: "用例", sub: prd !== "confirmed" && cases === "none" ? "待开始" : d?.casesStale ? "依据已变更" : PRD_STATUS[cases], done: cases === "confirmed" && !d?.casesStale, enabled: prd === "confirmed" || cases !== "none" },
    { key: "test" as const, label: "测试", sub: t?.active ? `第 ${t.active.round} 轮 · ${t.active.status === "queued" ? "排队" : t.active.status === "running" ? "执行中" : "待完成"}` : t?.rounds.length ? `${t.rounds.length} 轮` : cases === "confirmed" ? "未开始" : "等用例确认", done: !!t?.rounds.length && !t.active, enabled: cases === "confirmed" },
    { key: "report" as const, label: "报告", sub: TEST_STATE[t?.state || "none"], done: t?.state === "passed", enabled: !!t?.rounds.length },
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
          <p className="nv-dl-stream">
            {p.preview.length >= 1200 ? "…" : ""}
            {p.preview}
            {p.stage === "write" && !stalled ? <span className="nv-dl-caret" aria-hidden="true">▍</span> : null}
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

function PrdStage({ data, spaceId, pageId, skills, models, pick, setPick, credentialId, model, after }: StageProps & { pageId: string }) {
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
      <Chat stage="prd" data={data} models={models} pick={pick} setPick={setPick} credentialId={credentialId} model={model} after={after} readOnly={!data.canEdit} locked={st === "confirmed"} placeholder="说说要怎么改，比如：解绑后会话立即失效" />
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

function Chat({ stage, data, models, pick, setPick, credentialId, model, after, readOnly, locked, placeholder }: { stage: Stage; data: Data; models: ModelOpt[] | null; pick: string; setPick: (v: string) => void; credentialId: string; model: string; after: (refresh?: boolean) => Promise<void>; readOnly: boolean; locked: boolean; placeholder: string }) {
  const toast = useToast();
  const id = useId();
  const [text, setText] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const msgs = (data.messages || []).filter((m) => m.stage === stage);
  const d = data.delivery!;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs.length, sending]);

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
              {m.suggestions.map((s) => (
                <SuggCard key={s.id} s={s} busy={working === `${m.id}:${s.id}` || working === `${m.id}:all`} disabled={readOnly || (locked && s.status !== "applied")} locked={locked} onAct={(a) => void onSugg(m.id, s.id, a)} />
              ))}
              {!readOnly && !locked && m.suggestions.filter((s) => s.status === "pending").length > 1 ? (
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
              <p className="nv-dl-typing">
                <Loader2 size={14} className="nv-spin" aria-hidden="true" /> 正在想…
              </p>
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
