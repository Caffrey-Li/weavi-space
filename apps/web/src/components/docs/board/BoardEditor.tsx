"use client";

import "./asset-path";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { WorkHeader, type WorkCrumb } from "@/components/layout/WorkHeader";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { refreshDocsTree } from "@/components/docs/DocsNav";
import { TextToDiagram } from "./TextToDiagram";

const BoardCanvas = dynamic(() => import("./BoardCanvas"), { ssr: false, loading: () => <div className="nv-board-loading">正在打开画布…</div> });

type Save = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * 文档 · 画布编辑：Excalidraw 无限画布，改动 1.5 秒后自动保存草稿，「发布」成为新版本（和富文本页面同一套草稿 / 版本）。
 */
export function BoardEditor({
  crumbs,
  spaceId,
  page,
}: {
  crumbs: WorkCrumb[];
  spaceId: string;
  page: { id: string; title: string; scene: string; version: number; parentId: string | null };
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [title, setTitle] = useState(page.title);
  const [save, setSave] = useState<Save>("idle");
  const [publishing, setPublishing] = useState(false);
  const [ttd, setTtd] = useState(false);
  const sceneRef = useRef(page.scene);
  const titleRef = useRef(page.title);
  const timer = useRef<number | null>(null);
  const saving = useRef(false);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const first = useRef(true);

  const doSave = useCallback(async () => {
    if (saving.current) return false;
    saving.current = true;
    setSave("saving");
    try {
      const res = await fetch(`/api/docs/pages/${page.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titleRef.current, body: sceneRef.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "保存失败");
      setSave("saved");
      return true;
    } catch (e) {
      setSave("error");
      toast.error(e instanceof Error ? e.message : "保存失败");
      return false;
    } finally {
      saving.current = false;
    }
  }, [page.id, toast]);

  const schedule = useCallback(() => {
    setSave("dirty");
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void doSave();
    }, 1500);
  }, [doSave]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (timer.current != null || saving.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function onScene(json: string) {
    if (json === sceneRef.current) return;
    sceneRef.current = json;
    // Excalidraw 挂载时会先触发一次 onChange（模板转成图形也在这时），这次也要存下来
    if (first.current) {
      first.current = false;
      if (!JSON.parse(page.scene || "{}").template) return;
    }
    schedule();
  }

  async function publish() {
    const t = titleRef.current.trim();
    if (!t) return toast.error("请先填写画布标题");
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setPublishing(true);
    const res = await fetch(`/api/docs/pages/${page.id}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t, body: sceneRef.current }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPublishing(false);
      return toast.error(data.error || "发布失败");
    }
    refreshDocsTree();
    toast.success(page.version === 0 ? "画布已发布" : `已发布第 ${data.version} 版`);
    router.push(`/docs/${spaceId}/pages/${page.id}`);
    router.refresh();
  }

  async function cancel() {
    if (page.version > 0 && save === "idle") return router.push(`/docs/${spaceId}/pages/${page.id}`);
    const ok = await confirm({
      title: page.version === 0 ? "放弃这个新画布？" : "放弃本次修改？",
      body: page.version === 0 ? "画布还没有发布，放弃后草稿会被删除。想稍后再画，直接离开本页，草稿会自动保留。" : "未发布的修改会被丢弃，已发布的内容不受影响。",
      confirmLabel: page.version === 0 ? "放弃并删除" : "放弃修改",
      tone: "danger",
    });
    if (!ok) return;
    if (timer.current != null) window.clearTimeout(timer.current);
    const res = await fetch(`/api/docs/pages/${page.id}/draft`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "操作失败，请重试");
    refreshDocsTree();
    router.push(data.deleted ? (page.parentId ? `/docs/${spaceId}/pages/${page.parentId}` : `/docs/${spaceId}`) : `/docs/${spaceId}/pages/${page.id}`);
    router.refresh();
  }

  const saveText = save === "saving" ? "正在保存…" : save === "dirty" ? "有未保存的修改" : save === "saved" ? "草稿已自动保存" : save === "error" ? "保存失败" : page.version === 0 ? "新画布" : `第 ${page.version} 版`;

  return (
    <div className="nv-board-page">
      <WorkHeader
        crumbs={crumbs}
        actions={
          <>
            <span className={`doc-save-state${save === "error" ? " is-error" : ""}`} role="status" aria-live="polite">
              {saveText}
              {save === "error" ? (
                <button type="button" className="text-link" onClick={() => void doSave()}>
                  重试
                </button>
              ) : null}
            </span>
            <button type="button" className="btn-secondary nv-head-btn" onClick={() => setTtd(true)}>
              <Sparkles size={14} aria-hidden="true" />
              文字生成图
            </button>
            <button type="button" className="btn-secondary nv-head-btn" onClick={() => void cancel()} disabled={publishing}>
              取消
            </button>
            <button type="button" className="btn-primary nv-head-btn" onClick={() => void publish()} disabled={publishing} aria-busy={publishing}>
              {page.version === 0 ? "发布" : "更新"}
            </button>
          </>
        }
      />
      <div className="nv-board-title">
        <input
          className="nv-board-title-input"
          value={title}
          maxLength={200}
          placeholder="画布标题"
          aria-label="画布标题"
          onChange={(e) => {
            setTitle(e.target.value);
            titleRef.current = e.target.value;
            schedule();
          }}
        />
      </div>
      <BoardCanvas scene={page.scene} onChange={onScene} onApi={(api) => (apiRef.current = api)} />
      <TextToDiagram open={ttd} pageId={page.id} onClose={() => setTtd(false)} api={() => apiRef.current} />
    </div>
  );
}
