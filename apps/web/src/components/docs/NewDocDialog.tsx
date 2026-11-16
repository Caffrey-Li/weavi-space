"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

/**
 * 新建文档（Figma 47）：层级（产品 / 项目）→ 所属 → 文档类型（该空间的分组）→ 标题（选填），新建后进入编辑。
 * 任何地方都可以 openNewDoc({...}) 打开，预填层级 / 空间 / 类型；弹窗挂在文档侧栏的「新建页面」按钮里。
 */
export type NewDocInitial = { level?: "product" | "project"; spaceId?: string; groupKey?: string | null; groupId?: string | null };
const EVENT = "docs:new-doc";
const BOARD_TPLS = [
  { key: "blank", name: "空白画布", note: "从零开始自由画" },
  { key: "flow", name: "流程图", note: "开始、判断、结束" },
  { key: "arch", name: "系统架构图", note: "接入、服务、数据层" },
  { key: "swimlane", name: "泳道图", note: "按角色分工的流程" },
] as const;

export function openNewDoc(initial: NewDocInitial = {}) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: initial }));
}

type Tree = {
  products: { id: string; name: string; spaceId: string; projects: { id: string; name: string }[] }[];
  unassigned: { id: string; name: string }[];
};
type Group = { id: string; key: string | null; name: string };

export function NewDocDialogHost({ onCreated }: { onCreated?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tree, setTree] = useState<Tree | null>(null);
  const [level, setLevel] = useState<"product" | "project">("project");
  const [spaceId, setSpaceId] = useState("");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [canEdit, setCanEdit] = useState(true);
  const [groupId, setGroupId] = useState("");
  const [want, setWant] = useState<{ key?: string | null; id?: string | null }>({});
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const productOpts = useMemo(() => (tree?.products || []).filter((p) => p.spaceId).map((p) => ({ id: p.spaceId, label: p.name })), [tree]);
  const projectOpts = useMemo(
    () => [
      ...(tree?.products || []).flatMap((p) => p.projects.map((x) => ({ id: x.id, label: `${p.name} › ${x.name}` }))),
      ...(tree?.unassigned || []).map((x) => ({ id: x.id, label: `未归属产品 › ${x.name}` })),
    ],
    [tree],
  );
  const opts = level === "product" ? productOpts : projectOpts;

  useEffect(() => {
    function onOpen(e: Event) {
      const init = ((e as CustomEvent<NewDocInitial>).detail || {}) as NewDocInitial;
      setError("");
      setTitle("");
      setWant({ key: init.groupKey, id: init.groupId });
      setOpen(true);
      void fetch("/api/docs/spaces", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((t: Tree | null) => {
          if (!t) return;
          setTree(t);
          const isProductSpace = init.spaceId ? t.products.some((p) => p.spaceId === init.spaceId) : false;
          const lv = init.level || (isProductSpace ? "product" : "project");
          setLevel(lv);
          const list = lv === "product" ? t.products.filter((p) => p.spaceId).map((p) => p.spaceId) : [...t.products.flatMap((p) => p.projects.map((x) => x.id)), ...t.unassigned.map((x) => x.id)];
          setSpaceId(init.spaceId && list.includes(init.spaceId) ? init.spaceId : list[0] || "");
        })
        .catch(() => setError("读取空间失败，请重试"));
    }
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  // 换了空间：读它的分组，按预期类型选中（默认业务文档）
  useEffect(() => {
    if (!open || !spaceId) return;
    let alive = true;
    setGroups(null);
    void fetch(`/api/docs/spaces/${spaceId}/tree`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { groups: Group[]; canEdit: boolean } | null) => {
        if (!alive || !d) return;
        setGroups(d.groups);
        setCanEdit(d.canEdit);
        const hit = d.groups.find((g) => g.id === want.id) || d.groups.find((g) => want.key && g.key === want.key) || d.groups.find((g) => g.key === "project") || d.groups[0];
        setGroupId(hit?.id || "");
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open, spaceId, want]);

  function switchLevel(lv: "product" | "project") {
    if (lv === level) return;
    setLevel(lv);
    const list = lv === "product" ? productOpts : projectOpts;
    setSpaceId(list[0]?.id || "");
  }

  const [kind, setKind] = useState<"doc" | "board">("doc");
  const [template, setTemplate] = useState<"blank" | "flow" | "arch" | "swimlane">("blank");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!spaceId || busy) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/docs/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId, parentId: null, groupId: groupId || null, title: title.trim() || undefined, kind, template: kind === "board" ? template : undefined }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError((data as { error?: string }).error || "新建失败，请重试");
    setOpen(false);
    onCreated?.();
    toast.success(kind === "board" ? "已新建画布，开始画吧" : "已新建文档，开始编辑吧");
    router.push(`/docs/${spaceId}/pages/${(data as { id: string }).id}/edit`);
  }

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="新建文档" busy={busy} dirty={Boolean(title)} panelClassName="nv-prod-modal nv-newdoc-modal">
      <form className="nv-pform" onSubmit={submit} noValidate>
        <p className="nv-pform-intro">选择文档放在哪一层、哪个类型下；新建后直接进入编辑。</p>
        <div className="nv-pform-body">
          {error ? (
            <div role="alert" className="banner-error" tabIndex={-1}>
              {error}
            </div>
          ) : null}
          <div className="nv-pfield">
            <span className="nv-pfield-label" id="newdoc-level">
              层级
            </span>
            <div className="nv-pform-seg nv-newdoc-seg" role="group" aria-labelledby="newdoc-level">
              <button type="button" aria-pressed={level === "product"} disabled={!productOpts.length} onClick={() => switchLevel("product")}>
                产品
              </button>
              <button type="button" aria-pressed={level === "project"} disabled={!projectOpts.length} onClick={() => switchLevel("project")}>
                项目
              </button>
            </div>
            <span className="nv-set-hint">产品层：放跨项目的产品说明、规范；项目层：放某个项目的方案、接口和过程文档</span>
          </div>
          <label className="nv-pfield" htmlFor="newdoc-space">
            <span className="nv-pfield-label">{level === "product" ? "所属产品" : "所属项目"}</span>
            <select id="newdoc-space" className="input" value={spaceId} disabled={!tree} onChange={(e) => setSpaceId(e.target.value)}>
              {!tree ? <option value="">正在读取…</option> : null}
              {tree && !opts.length ? <option value="">{level === "product" ? "没有可用的产品" : "没有可用的项目"}</option> : null}
              {opts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="nv-pfield">
            <span className="nv-pfield-label" id="newdoc-type">
              文档类型
            </span>
            {groups ? (
              <div className="nv-pform-seg nv-newdoc-seg is-wrap" role="group" aria-labelledby="newdoc-type">
                {groups.map((g) => (
                  <button key={g.id} type="button" aria-pressed={groupId === g.id} onClick={() => setGroupId(g.id)}>
                    {g.name}
                  </button>
                ))}
              </div>
            ) : (
              <span className="nv-set-hint">{spaceId ? "正在读取分组…" : "先选择所属"}</span>
            )}
            <span className="nv-set-hint">默认三类之外的分组来自该空间里自定义的分组</span>
          </div>
          <div className="nv-pfield">
            <span className="nv-pfield-label" id="newdoc-kind">
              页面形式
            </span>
            <div className="nv-pform-seg nv-newdoc-seg" role="group" aria-labelledby="newdoc-kind">
              <button type="button" aria-pressed={kind === "doc"} onClick={() => setKind("doc")}>
                文档
              </button>
              <button type="button" aria-pressed={kind === "board"} onClick={() => setKind("board")}>
                画布
              </button>
            </div>
            {kind === "board" ? (
              <>
                <div className="nv-newdoc-tpls" role="radiogroup" aria-label="画布模板">
                  {BOARD_TPLS.map((t) => (
                    <button key={t.key} type="button" role="radio" aria-checked={template === t.key} className={`nv-newdoc-tpl is-${t.key}${template === t.key ? " is-on" : ""}`} onClick={() => setTemplate(t.key)}>
                      <span className="nv-newdoc-tpl-thumb" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      <b>{t.name}</b>
                      <small>{t.note}</small>
                    </button>
                  ))}
                </div>
                <span className="nv-set-hint">画布是无限大的白板，可以画流程图、架构图；也能用「文字生成图」从 Mermaid 或一句描述自动生成。</span>
              </>
            ) : null}
          </div>
          <label className="nv-pfield" htmlFor="newdoc-title">
            <span className="nv-pfield-label">标题（选填）</span>
            <input id="newdoc-title" className="input" value={title} maxLength={200} placeholder={kind === "board" ? "不填则为「无标题画布」，进入编辑后再改" : "不填则为「无标题页面」，进入编辑后再改"} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {!canEdit ? <p className="nv-set-error">你没有这个空间的文档编辑权限，换一个空间试试</p> : null}
        </div>
        <div className="nv-pform-foot">
          <span className="nv-pform-note">在侧栏分组上点「+」仍可直接新建到该分组</span>
          <ModalCancelButton className="btn-secondary nv-head-btn" />
          <button type="submit" className="btn-primary nv-head-btn" disabled={!spaceId || !groups || !canEdit || busy} aria-busy={busy || undefined}>
            {busy ? "新建中…" : "新建并编辑"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
