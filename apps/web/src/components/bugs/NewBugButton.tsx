"use client";

import { useLifecycle } from "@/components/lifecycle/useLifecycle";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { BugFormModal, bugPayload, emptyBug, type BugFormValues } from "./BugForm";

export function NewBugButton({
  defaultProjectId,
  defaultRequirementId,
  label = "新建 Bug",
  variant = "primary",
  className,
  icon = true,
  iconNode,
  ariaLabel,
  title,
  fullPage = true,
}: {
  /** true：跳到新建 Bug 全页（Figma 28）；false：快速弹窗 */
  fullPage?: boolean;
  className?: string;
  icon?: boolean;
  /** 自定义图标（替代默认的 +） */
  iconNode?: React.ReactNode;
  ariaLabel?: string;
  title?: string;
  defaultProjectId?: string;
  defaultRequirementId?: string;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (fullPage) {
    const sp = new URLSearchParams();
    if (defaultProjectId) sp.set("project", defaultProjectId);
    if (defaultRequirementId) sp.set("requirement", defaultRequirementId);
    const qs = sp.toString();
    return (
      <Link
        href={`/bugs/new${qs ? `?${qs}` : ""}`}
        className={className || (variant === "primary" ? "btn-primary" : "btn-secondary")}
        aria-label={ariaLabel}
        title={title}
      >
        {iconNode ?? (icon ? <Plus size={16} aria-hidden="true" /> : null)}
        {label}
      </Link>
    );
  }
  return (
    <>
      <button
        type="button"
        className={className || (variant === "primary" ? "btn-primary" : "btn-secondary")}
        aria-label={ariaLabel}
        title={title}
        onClick={() => setOpen(true)}
      >
        {iconNode ?? (icon ? <Plus size={16} aria-hidden="true" /> : null)}
        {label}
      </button>
      <BugFormModal
        open={open}
        mode="create"
        initial={emptyBug(defaultProjectId, defaultRequirementId)}
        onClose={() => setOpen(false)}
        onSubmit={async (v) => {
          const res = await fetch("/api/bugs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bugPayload(v, "create")),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) return (data as { error?: string }).error || "提交失败，输入已保留";
          setOpen(false);
          toast.success(`已提交 Bug「${v.title}」`);
          router.refresh();
          return null;
        }}
      />
    </>
  );
}

/** 编辑已有 Bug 的弹窗（看板卡片 / 列表行点击打开） */
export function BugEditModal({
  bug,
  canDelete = false,
  onClose,
}: {
  canDelete?: boolean;
  bug: (BugFormValues & { id: string; ownerNames?: { frontend?: string | null; backend?: string | null } }) | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const runLifecycle = useLifecycle();
  // 打开时读取 Bug 全部字段：富文本描述（列表里只有纯文本摘要，直接编辑会丢图片和格式）和扩展字段
  const [full, setFull] = useState<(BugFormValues & { id: string; ownerNames?: { frontend?: string | null; backend?: string | null } }) | null>(null);
  // 调用方每次渲染都会新建 bug 对象（toBugForm），所以按 id 触发，基础值存进 ref
  const bugId = bug?.id ?? null;
  const baseRef = useRef(bug);
  baseRef.current = bug;
  useEffect(() => {
    const bug = baseRef.current;
    if (!bugId || !bug) return setFull(null);
    let alive = true;
    setFull(null);
    fetch(`/api/bugs/${bug.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { bug?: Record<string, string | null> } | null) => {
        if (!alive) return;
        const b = d?.bug;
        if (!b) return setFull(bug);
        setFull({
          ...bug,
          title: b.title || bug.title,
          summary: b.descriptionHtml || "",
          projectId: b.projectId || "",
          requirementId: b.requirementId || "",
          frontendId: b.frontendId || "",
          backendId: b.backendId || "",
          severity: b.severity || bug.severity,
          status: b.status || bug.status,
          dueAt: b.dueAt || "",
          environment: b.environment || "",
          device: b.device || "",
          foundVersion: b.foundVersion || "",
          docUrl: b.docUrl || "",
          productId: b.productId || "",
          productNodeId: b.productNodeId || "",
          ownerNames: { frontend: b.frontendName ?? bug.ownerNames?.frontend, backend: b.backendName ?? bug.ownerNames?.backend },
        });
      })
      .catch(() => alive && setFull(bug));
    return () => {
      alive = false;
    };
  }, [bugId]);
  return (
    <BugFormModal
      open={!!bug && !!full}
      mode="edit"
      initial={full ?? emptyBug()}
      initialOwnerNames={full?.ownerNames}
      onClose={onClose}
      footLead={
        bug && full ? (
          <>
            <button type="button" className="btn-ghost" onClick={() => void runLifecycle("bug", bug.id, full.title, "archive", onClose)}>
              归档
            </button>
            {canDelete ? (
              <button type="button" className="btn-ghost text-nv-danger-fg" onClick={() => void runLifecycle("bug", bug.id, full.title, "delete", onClose)}>
                删除
              </button>
            ) : null}
          </>
        ) : null
      }
      onSubmit={async (v) => {
        if (!bug) return null;
        const res = await fetch(`/api/bugs/${bug.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bugPayload(v, "edit")),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return (data as { error?: string }).error || "保存失败，输入已保留";
        onClose();
        toast.success("Bug 已保存");
        router.refresh();
        return null;
      }}
    />
  );
}
