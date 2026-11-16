"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutTemplate } from "lucide-react";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";

type T = { id: string; name: string; projectId: string | null; data: Record<string, unknown> };

/**
 * 新建需求 / Bug 的个人模板：按当前项目列出（项目模板在前，再是通用模板），选中即带出预设内容；
 * 也可以把当前填写的内容存成模板（只对自己有效）。
 */
export function TemplateMenu({ kind, projectId, current, onApply }: { kind: "requirement" | "bug"; projectId: string; current: () => Record<string, unknown>; onApply: (data: Record<string, unknown>) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<T[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/templates?kind=${kind}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`, { cache: "no-store" });
    if (r.ok) setList((await r.json()).templates || []);
  }, [kind, projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function saveAs() {
    setOpen(false);
    const title = `模板 ${new Date().toLocaleDateString("zh-CN")}`;
    const ok = await confirm({ title: "把当前填写的内容存成模板？", body: `保存${projectId ? "为当前项目的模板" : "为通用模板"}，名称「${title}」，之后可在这里删除。标题不会存进模板。`, confirmLabel: "保存" });
    if (!ok) return;
    const r = await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, name: title, projectId: projectId || null, data: current() }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(d.error || "保存失败");
    toast.success("已存为模板");
    void load();
  }
  async function remove(t: T) {
    if (!(await confirm({ title: `删除模板「${t.name}」？`, confirmLabel: "删除", tone: "danger" }))) return;
    await fetch(`/api/templates/${t.id}`, { method: "DELETE" });
    void load();
  }

  return (
    <div className="nv-prop-wrap nv-tpl" ref={ref}>
      <button type="button" className="nv-prop" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <LayoutTemplate size={14} aria-hidden="true" />
        模板{list.length ? ` ${list.length}` : ""}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open ? (
        <div className="nv-prop-pop" role="menu" style={{ width: 260 }}>
          {list.length === 0 ? <p className="nv-ai-pop-group">还没有模板</p> : null}
          {list.map((t) => (
            <div key={t.id} className="nv-tpl-row">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onApply(t.data);
                  setOpen(false);
                  toast.success(`已套用「${t.name}」`);
                }}
              >
                {t.name}
                <span className="nv-ai-note">{t.projectId ? " · 本项目" : " · 通用"}</span>
              </button>
              <button type="button" className="nv-tpl-del" aria-label={`删除模板 ${t.name}`} onClick={() => void remove(t)}>
                ×
              </button>
            </div>
          ))}
          <button type="button" role="menuitem" className="nv-tpl-save" onClick={() => void saveAs()}>
            把当前内容存为模板…
          </button>
        </div>
      ) : null}
    </div>
  );
}
