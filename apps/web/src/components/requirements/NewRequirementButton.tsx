"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { RequirementCreateModal, requirementCreatePayload } from "./RequirementCreateModal";

export const REQUIREMENT_CREATED_EVENT = "pm:requirement-created";

/**
 * 新建需求。成功后留在当前页（便于连续录入）：刷新列表并高亮新行，
 * Toast 提供「查看」入口；不再强制跳转到详情。
 */
export function NewRequirementButton({
  defaultProjectId,
  lockProject = false,
  label = "新建需求",
  className = "btn-primary",
  icon,
  iconOnly = false,
  fullPage = true,
}: {
  /** true：跳到新建需求全页（Figma 25）；false：快速新建弹窗（看板列里用） */
  fullPage?: boolean;
  defaultProjectId?: string;
  /** 项目需求池内新建时锁定项目，不可改到其他项目 */
  lockProject?: boolean;
  label?: string;
  /** 按钮样式类，默认主按钮；导航栏里用 ws-nav-create */
  className?: string;
  /** 自定义前置图标；null 不显示图标 */
  icon?: React.ReactNode;
  /** 只显示图标（分组头上的「+」），文字作为读屏标签 */
  iconOnly?: boolean;
} = {}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const fullHref = `/requirements/new${defaultProjectId ? `?project=${encodeURIComponent(defaultProjectId)}` : ""}`;

  if (fullPage) {
    return (
      <Link href={fullHref} className={className} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined}>
        {icon === undefined ? <Plus size={iconOnly ? 16 : 14} aria-hidden="true" /> : icon}
        {iconOnly ? null : label}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
      >
        {icon === undefined ? <Plus size={iconOnly ? 16 : 14} aria-hidden="true" /> : icon}
        {iconOnly ? null : label}
      </button>
      <RequirementCreateModal
        open={open}
        defaultProjectId={defaultProjectId || ""}
        lockProject={lockProject}
        fullHref={fullHref}
        onClose={() => setOpen(false)}
        onSubmit={async (values, keepOpen) => {
          const res = await fetch("/api/requirements", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requirementCreatePayload(values)),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) return (data as { error?: string }).error || "创建失败，输入已保留";
          const id = (data as { id?: string }).id;
          if (!keepOpen) setOpen(false);
          router.refresh();
          if (id) window.dispatchEvent(new CustomEvent(REQUIREMENT_CREATED_EVENT, { detail: { id } }));
          toast.show({
            tone: "success",
            message: `已创建「${values.title.length > 24 ? `${values.title.slice(0, 24)}…` : values.title}」`,
            action: id ? { label: "查看", onClick: () => router.push(`/requirements/${id}`) } : undefined,
          });
          return null;
        }}
      />
    </>
  );
}
