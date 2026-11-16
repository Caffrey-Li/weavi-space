"use client";

import { useEffect, useId, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

type Opt = { credentialId: string; model: string; label: string; disabled: boolean; reason?: string };

const SAMPLE = "flowchart LR\n  A([提交需求]) --> B[产品评审] --> C{是否通过？}\n  C -- 通过 --> D[排期开发] --> E[测试上线]\n  C -- 不通过 --> F[退回修改] --> B";

/**
 * 画布「文字生成图」：让小围按描述画（返回 Mermaid，可改），或直接粘贴 Mermaid 代码；
 * 用 @excalidraw/mermaid-to-excalidraw 转成画布图形，放到画布里继续编辑。
 */
export function TextToDiagram({ open, pageId, onClose, api }: { open: boolean; pageId: string; onClose: () => void; api: () => ExcalidrawImperativeAPI | null }) {
  const toast = useToast();
  const id = useId();
  const [mode, setMode] = useState<"ai" | "mermaid">("ai");
  const [prompt, setPrompt] = useState("");
  const [code, setCode] = useState("");
  const [opts, setOpts] = useState<Opt[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || opts) return;
    fetch("/api/ai/models", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { options?: Opt[] }) => {
        const list = d.options || [];
        setOpts(list);
        const first = list.find((o) => !o.disabled);
        if (first) setPick(`${first.credentialId}|${first.model}`);
      })
      .catch(() => setOpts([]));
  }, [open, opts]);

  async function askAi() {
    if (!prompt.trim() || busy) return;
    const [credentialId, model] = pick.split("|");
    if (!credentialId) return toast.error("请先在「设置 · 模型管理」添加模型");
    setBusy(true);
    const r = await fetch("/api/docs/board-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId, prompt, credentialId, model }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast.error(d.error || "生成失败");
    setCode(d.mermaid);
  }

  async function place() {
    const a = api();
    if (!a || !code.trim()) return;
    setBusy(true);
    try {
      const [{ parseMermaidToExcalidraw }, { convertToExcalidrawElements }] = await Promise.all([import("@excalidraw/mermaid-to-excalidraw"), import("@excalidraw/excalidraw")]);
      const { elements, files } = await parseMermaidToExcalidraw(code, { themeVariables: { fontSize: "16px" } });
      // 和模板一致：规整线条、无衬线字体
      const styled = elements.map((e) => ({ ...e, roughness: 0, ...(e.type === "text" ? { fontFamily: 2 } : {}), ...("label" in e && e.label ? { label: { ...e.label, fontFamily: 2 } } : {}) })) as typeof elements;
      const fresh = convertToExcalidrawElements(styled, { regenerateIds: true });
      // 放在现有图形的右边，不压住原来的内容
      const existing = a.getSceneElements();
      const maxX = existing.reduce((m, e) => Math.max(m, e.x + e.width), 0);
      const dx = existing.length ? maxX + 120 : 0;
      const moved = fresh.map((e) => ({ ...e, x: e.x + dx }));
      if (files) a.addFiles(Object.values(files));
      a.updateScene({ elements: [...existing, ...moved] });
      a.scrollToContent(moved, { fitToContent: true, animate: true });
      toast.success("已放到画布");
      onClose();
    } catch (e) {
      toast.error(`没能识别这段 Mermaid：${e instanceof Error ? e.message.slice(0, 80) : "格式不对"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="文字生成图" busy={busy}>
      <div className="nv-ttd">
        <div className="nv-pform-seg" role="group" aria-label="生成方式">
          <button type="button" aria-pressed={mode === "ai"} onClick={() => setMode("ai")} style={{ width: 88 }}>
            让小围画
          </button>
          <button type="button" aria-pressed={mode === "mermaid"} onClick={() => setMode("mermaid")} style={{ width: 104 }}>
            Mermaid 代码
          </button>
        </div>
        {mode === "ai" ? (
          <>
            <label className="nv-set-field" htmlFor={`${id}-p`}>
              描述
              <textarea id={`${id}-p`} className="input nv-set-textarea" rows={4} maxLength={2000} value={prompt} placeholder="例如：画一张需求评审流程图：提交需求 → 产品评审 → 是否通过，通过就排期开发、测试上线，不通过退回修改后重新评审。" onChange={(e) => setPrompt(e.target.value)} />
            </label>
            <div className="nv-ttd-row">
              <label className="nv-set-field" htmlFor={`${id}-m`} style={{ flex: 1 }}>
                模型
                <select id={`${id}-m`} className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
                  {!opts?.length ? <option value="">还没有模型（设置 · 模型管理）</option> : null}
                  {(opts || []).map((o) => (
                    <option key={`${o.credentialId}|${o.model}`} value={`${o.credentialId}|${o.model}`} disabled={o.disabled}>
                      {o.label}
                      {o.disabled ? "（token 不足）" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn-secondary nv-head-btn" onClick={() => void askAi()} disabled={busy || !prompt.trim()}>
                {busy ? "生成中…" : code ? "重新生成" : "生成"}
              </button>
            </div>
          </>
        ) : null}
        <label className="nv-set-field" htmlFor={`${id}-c`}>
          {mode === "ai" ? "生成结果（Mermaid，可以改了再放到画布）" : "Mermaid 代码"}
          <textarea id={`${id}-c`} className="input nv-set-textarea is-code" rows={8} value={code} placeholder={SAMPLE} onChange={(e) => setCode(e.target.value)} />
        </label>
      </div>
      <div className="nv-pform-foot">
        <span className="nv-pform-note">生成的图形会放到现有内容右边，可以继续拖动修改</span>
        <ModalCancelButton className="btn-secondary nv-head-btn" />
        <button type="button" className="btn-primary nv-head-btn" onClick={() => void place()} disabled={busy || !code.trim()}>
          放到画布
        </button>
      </div>
    </Modal>
  );
}
