"use client";

import { useRouter } from "next/navigation";
import { Archive, Copy, Inbox, Link2, Plus, Trash2 } from "lucide-react";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { useLifecycle } from "@/components/lifecycle/useLifecycle";
import { useToast } from "@/components/ui/Toast";

/** 需求详情页头「⋯」（Figma 24）：复制链接 / 复制编号 / 在需求池中查看 / 新建子需求 / 归档 / 删除（进回收站） */
export function RequirementMoreMenu({
  id,
  code,
  title,
  projectId,
  poolHref,
  canEdit,
  canCreate,
}: {
  id: string;
  code: string;
  title: string;
  projectId: string | null;
  poolHref: string;
  canEdit: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  async function copy(text: string, msg: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(msg);
    } catch {
      toast.error("复制失败，请手动复制");
    }
  }

  const run = useLifecycle();
  async function act(action: "archive" | "delete") {
    await run("requirement", id, title, action, () => router.push(poolHref));
  }

  const childHref = `/requirements/new?parent=${encodeURIComponent(id)}${projectId ? `&project=${encodeURIComponent(projectId)}` : ""}`;
  return (
    <ActionMenu
      label="需求更多操作"
      items={[
        { label: "复制链接", icon: Link2, onSelect: () => void copy(`${window.location.origin}/requirements/${id}`, "已复制链接") },
        { label: "复制编号", icon: Copy, onSelect: () => void copy(code, `已复制 ${code}`) },
        { label: "在需求池中查看", icon: Inbox, onSelect: () => router.push(poolHref) },
        ...(canCreate ? [{ label: "新建子需求", icon: Plus, onSelect: () => router.push(childHref) }] : []),
        ...(canEdit
          ? [
              { label: "归档需求", icon: Archive, divider: true, onSelect: () => void act("archive") },
              { label: "删除需求", icon: Trash2, tone: "danger" as const, onSelect: () => void act("delete") },
            ]
          : []),
      ]}
    />
  );
}
