"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, FileText, ListChecks, Bug as BugIcon, ArrowRight } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";

export type RequirementFlowData = {
  stage: number;
  stages: readonly string[];
  next: { label: string; href?: string; action?: "convert" } | null;
  hint: string;
  canConvert: boolean;
  doc: { id: string; title: string; href: string; version: number } | null;
  prd: { id: string; title: string; href: string; status?: string; version: number } | null;
  cases: { id: string; title: string; href: string; status?: string; passed: boolean; rounds: number } | null;
  others: { id: string; title: string; href: string }[];
  children: { total: number; online: number };
  openBugs: number;
  projectId: string | null;
};

type Proj = { id: string; name: string };

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "操作失败，请重试");
  return d;
}

/** 转化为需求文档：公共池的需求先选项目 */
function useConvert(id: string, flow: RequirementFlowData) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pick, setPick] = useState(false);
  const run = async (projectId?: string) => {
    try {
      const d = await post(`/api/requirements/${id}/flow`, { action: "convert", projectId });
      toast.success("已转化为需求文档");
      router.push(d.href);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const start = async () => {
    if (!flow.projectId) return setPick(true);
    if (await confirm({ title: "转化为需求文档？", body: "会在项目的文档空间建一篇需求文档，带上标题、描述和提出人，并和这条需求双向关联。之后可以在文档里用「需求交付」生成 PRD。", confirmLabel: "转化" })) await run();
  };
  return { start, pick, setPick, run };
}

function ProjectPick({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const [projects, setProjects] = useState<Proj[] | null>(null);
  const [sel, setSel] = useState("");
  useEffect(() => {
    if (!open || projects !== null) return;
    fetch("/api/meta")
      .then((r) => r.json())
      .then((d: { projects?: Proj[] }) => setProjects(d.projects || []))
      .catch(() => setProjects([]));
  }, [open, projects]);
  return (
    <Modal open={open} onClose={onClose} title="放到哪个项目？">
      <div className="nv-flow-pick">
        <p>这条需求在公共需求池里，需求文档要放到一个项目的文档空间。</p>
        <select className="input" value={sel} onChange={(e) => setSel(e.target.value)} aria-label="项目">
          <option value="">选择项目</option>
          {(projects || []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="nv-pform-foot">
        <span className="nv-pform-note" />
        <ModalCancelButton className="btn-secondary nv-head-btn" />
        <button type="button" className="btn-primary nv-head-btn" disabled={!sel} onClick={() => onPick(sel)}>
          转化
        </button>
      </div>
    </Modal>
  );
}

/** 需求详情顶部：六段进度 + 下一步 */
export function RequirementFlowBar({ id, flow }: { id: string; flow: RequirementFlowData }) {
  const conv = useConvert(id, flow);
  const done = flow.stage >= flow.stages.length;
  return (
    <section className="nv-flow" aria-label="需求进度">
      <div className="nv-flow-row">
        <ol className="nv-flow-steps">
          {flow.stages.map((s, i) => {
            const st = done || i < flow.stage ? "done" : i === flow.stage ? "active" : "todo";
            return (
              <li key={s} className="nv-flow-step" data-state={st} aria-current={st === "active" ? "step" : undefined}>
                {st === "done" ? <Check size={12} aria-hidden="true" /> : <span className="nv-flow-dot" aria-hidden="true" />}
                {s}
              </li>
            );
          })}
        </ol>
        {flow.next ? (
          flow.next.action === "convert" ? (
            flow.canConvert ? (
              <button type="button" className="btn-primary nv-head-btn" onClick={() => void conv.start()}>
                {flow.next.label}
              </button>
            ) : null
          ) : (
            <Link className="btn-primary nv-head-btn" href={flow.next.href!}>
              {flow.next.label}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          )
        ) : null}
      </div>
      <p className="nv-flow-hint">{flow.hint}</p>
      <div className="nv-flow-links">
        {flow.doc ? (
          <Link href={flow.doc.href}>
            <FileText size={13} aria-hidden="true" />
            需求文档
          </Link>
        ) : null}
        {flow.prd ? (
          <Link href={flow.prd.href}>
            <FileText size={13} aria-hidden="true" />
            PRD{flow.prd.status === "confirmed" ? ` · 已确认 v${flow.prd.version}` : " · 草稿"}
          </Link>
        ) : null}
        {flow.cases ? (
          <Link href={flow.cases.href}>
            <ListChecks size={13} aria-hidden="true" />
            测试用例{flow.cases.rounds ? ` · 第 ${flow.cases.rounds} 轮${flow.cases.passed ? "通过" : ""}` : ""}
          </Link>
        ) : null}
        {flow.children.total ? (
          <a href="#rq-sub-title">
            实现需求 {flow.children.total} 条 · 已上线 {flow.children.online}
          </a>
        ) : null}
        {flow.openBugs ? (
          <span className="nv-flow-bugs">
            <BugIcon size={13} aria-hidden="true" />
            未解决 Bug {flow.openBugs}
          </span>
        ) : null}
      </div>
      <ProjectPick open={conv.pick} onClose={() => conv.setPick(false)} onPick={(p) => (conv.setPick(false), void conv.run(p))} />
    </section>
  );
}

type DocRow = { id: string; title: string; spaceId: string; spaceName: string };

/** 需求文档区块：主文档 / PRD / 用例 / 其他引用；缺文档时转化或关联已有文档 */
export function RequirementDocs({ id, flow, canEdit, variant = "full" }: { id: string; flow: RequirementFlowData; canEdit: boolean; variant?: "full" | "manage" }) {
  const router = useRouter();
  const toast = useToast();
  const conv = useConvert(id, flow);
  const [linking, setLinking] = useState(false);
  const [rows, setRows] = useState<DocRow[] | null>(null);
  const [q, setQ] = useState("");
  const shown = useMemo(() => (rows || []).filter((r) => !q || r.title.includes(q) || r.spaceName.includes(q)).slice(0, 50), [rows, q]);
  const openLink = () => {
    setLinking(true);
    if (rows === null)
      fetch("/api/docs/list")
        .then((r) => r.json())
        .then((d: { rows?: (DocRow & { type?: string })[] }) => setRows((d.rows || []).filter((x) => x.type !== "board")))
        .catch(() => setRows([]));
  };
  const setDoc = async (pageId: string | null) => {
    try {
      await post(`/api/requirements/${id}/flow`, { action: "setDoc", pageId });
      toast.success(pageId ? "已关联为主需求文档" : "已取消主需求文档");
      setLinking(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const dialogs = (
    <>
      <ProjectPick open={conv.pick} onClose={() => conv.setPick(false)} onPick={(p) => (conv.setPick(false), void conv.run(p))} />
      <Modal open={linking} onClose={() => setLinking(false)} title="选择主需求文档">
        <div className="nv-flow-pick">
          <input className="input" value={q} placeholder="搜索文档标题或空间" aria-label="搜索文档" onChange={(e) => setQ(e.target.value)} />
          <ul className="nv-flow-picklist">
            {rows === null ? <li className="nv-flow-meta">正在加载…</li> : null}
            {rows && !shown.length ? <li className="nv-flow-meta">没有找到文档</li> : null}
            {shown.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => void setDoc(r.id)}>
                  <span>{r.title}</span>
                  <small>{r.spaceName}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="nv-pform-foot">
          {flow.doc ? (
            <button type="button" className="btn-secondary nv-head-btn" onClick={() => void setDoc(null)}>
              取消主文档
            </button>
          ) : null}
          <span className="nv-pform-note" />
          <ModalCancelButton className="btn-secondary nv-head-btn" />
        </div>
      </Modal>
    </>
  );
  // 有主文档时，资料区块（T42）里已经列出了主文档 / PRD / 用例，这里只留「更换主文档」入口
  if (variant === "manage") {
    if (!flow.doc || !canEdit) return null;
    return (
      <>
        <button type="button" className="text-link" onClick={openLink}>
          更换主文档
        </button>
        {dialogs}
      </>
    );
  }
  return (
    <section className="nv-flow-docs" aria-labelledby="rq-docs-title">
      <div className="nv-flow-docs-head">
        <h2 id="rq-docs-title">需求文档</h2>
        {canEdit && flow.doc ? (
          <button type="button" className="text-link" onClick={openLink}>
            更换主文档
          </button>
        ) : null}
      </div>
      {flow.doc ? (
        <ul className="nv-flow-doclist">
          <li>
            <Link href={flow.doc.href}>
              <FileText size={14} aria-hidden="true" />
              <span>{flow.doc.title}</span>
            </Link>
            <span className="nv-flow-meta">主需求文档 · 第 {flow.doc.version} 版</span>
          </li>
          {flow.prd ? (
            <li>
              <Link href={flow.prd.href}>
                <FileText size={14} aria-hidden="true" />
                <span>{flow.prd.title}</span>
              </Link>
              <span className={`nv-dl-tag${flow.prd.status === "confirmed" ? " tone-success" : ""}`}>{flow.prd.status === "confirmed" ? `已确认 v${flow.prd.version}` : "草稿"}</span>
            </li>
          ) : null}
          {flow.cases ? (
            <li>
              <Link href={flow.cases.href}>
                <ListChecks size={14} aria-hidden="true" />
                <span>{flow.cases.title}</span>
              </Link>
              <span className={`nv-dl-tag${flow.cases.passed ? " tone-success" : ""}`}>{flow.cases.passed ? "测试通过" : flow.cases.status === "confirmed" ? "已确认" : "草稿"}</span>
            </li>
          ) : null}
        </ul>
      ) : (
        <div className="nv-flow-empty">
          <p className="nv-flow-empty-title">缺少需求文档</p>
          <p>转化后会在项目的文档空间建一篇需求文档，带上标题、描述和提出人，并和这条需求双向关联；接着可以用「需求交付」生成 PRD。</p>
          {canEdit ? (
            <div className="nv-flow-empty-ops">
              {flow.canConvert ? (
                <button type="button" className="btn-primary nv-head-btn" onClick={() => void conv.start()}>
                  转化为需求文档
                </button>
              ) : null}
              <button type="button" className="btn-secondary nv-head-btn" onClick={openLink}>
                关联已有文档
              </button>
            </div>
          ) : null}
        </div>
      )}
      {flow.others.length ? (
        <p className="nv-flow-others">
          另有 {flow.others.length} 篇文档引用了这条需求：
          {flow.others.map((o, i) => (
            <span key={o.id}>
              {i ? "、" : ""}
              <Link className="text-link" href={o.href}>
                {o.title}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
      {dialogs}
    </section>
  );
}

/** 文档阅读页顶部：这篇文档属于哪条需求 */
export function DocRequirementBar({ items }: { items: { id: string; title: string; status: string; href: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="nv-flow-docbar" role="note">
      所属需求：
      {items.map((r, i) => (
        <span key={r.id}>
          {i ? "、" : ""}
          <Link className="text-link" href={r.href}>
            {r.title}
          </Link>
          <span className="nv-flow-meta"> · {r.status}</span>
        </span>
      ))}
    </div>
  );
}

type Cand = { title: string; description: string; priority: string; on: boolean };
type ModelOpt = { credentialId: string; model: string; label: string; disabled: boolean };
const PRI = [
  ["p0", "紧急"],
  ["p1", "高"],
  ["p2", "中"],
  ["p3", "低"],
] as const;

/** 文档页「提取需求」：小围读正文列出候选，勾选、改好后再建进需求池，并关联这篇文档 */
export function ExtractRequirementsButton({ pageId }: { pageId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelOpt[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Cand[] | null>(null);
  useEffect(() => {
    if (!open || models) return;
    fetch("/api/ai/models", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { options?: ModelOpt[] }) => {
        const list = d.options || [];
        setModels(list);
        const first = list.find((o) => !o.disabled);
        if (first) setPick(`${first.credentialId}|${first.model}`);
      })
      .catch(() => setModels([]));
  }, [open, models]);
  const extract = async () => {
    const [credentialId, model] = pick.split("|");
    if (!credentialId) return toast.error("请先在「设置 · 模型管理」添加模型");
    setBusy(true);
    try {
      const d = await post(`/api/docs/pages/${pageId}/requirements`, { action: "extract", credentialId, model });
      setItems((d.items as Omit<Cand, "on">[]).map((x) => ({ ...x, on: true })));
      if (!d.items.length) toast.error("没有从文档里找到需求");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    const chosen = (items || []).filter((x) => x.on && x.title.trim());
    if (!chosen.length) return toast.error("请至少勾选一条");
    setBusy(true);
    try {
      const d = await post(`/api/docs/pages/${pageId}/requirements`, { action: "create", items: chosen });
      toast.success(`已建 ${d.created} 条需求，并关联这篇文档`);
      setOpen(false);
      setItems(null);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const set = (i: number, patch: Partial<Cand>) => setItems((xs) => (xs || []).map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <>
      <button type="button" className="btn-secondary nv-head-btn" onClick={() => setOpen(true)}>
        提取需求
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="从文档提取需求" wide busy={busy}>
        <div className="nv-flow-pick">
          {items === null ? (
            <>
              <p>小围会读这篇文档，列出里面要做的需求。你勾选、改好后再建进需求池，建好的需求自动关联这篇文档。</p>
              <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="模型">
                {!models?.length ? <option value="">{models ? "还没有模型（设置 · 模型管理）" : "正在加载模型…"}</option> : null}
                {(models || []).map((o) => (
                  <option key={`${o.credentialId}|${o.model}`} value={`${o.credentialId}|${o.model}`} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <ul className="nv-extract-list">
              {items.map((x, i) => (
                <li key={i}>
                  <input type="checkbox" checked={x.on} aria-label={`选中第 ${i + 1} 条`} onChange={(e) => set(i, { on: e.target.checked })} />
                  <div>
                    <input className="input" value={x.title} maxLength={200} aria-label={`第 ${i + 1} 条标题`} onChange={(e) => set(i, { title: e.target.value })} />
                    <p>{x.description.slice(0, 160)}</p>
                  </div>
                  <select className="input" value={x.priority} aria-label={`第 ${i + 1} 条优先级`} onChange={(e) => set(i, { priority: e.target.value })}>
                    {PRI.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="nv-pform-foot">
          {items ? (
            <button type="button" className="btn-secondary nv-head-btn" disabled={busy} onClick={() => setItems(null)}>
              重新提取
            </button>
          ) : null}
          <span className="nv-pform-note">{items ? `已选 ${items.filter((x) => x.on).length} / ${items.length}` : ""}</span>
          <ModalCancelButton className="btn-secondary nv-head-btn" />
          {items ? (
            <button type="button" className="btn-primary nv-head-btn" disabled={busy} onClick={() => void create()}>
              {busy ? "正在建…" : "建到需求池"}
            </button>
          ) : (
            <button type="button" className="btn-primary nv-head-btn" disabled={busy || !pick} onClick={() => void extract()}>
              {busy ? "正在提取…" : "提取"}
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
