"use client";

import { useRouter } from "next/navigation";
import { Archive, Copy, List, Link2, Trash2 } from "lucide-react";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { useLifecycle } from "@/components/lifecycle/useLifecycle";
import { useToast } from "@/components/ui/Toast";

/** Bug 详情页头「⋯」：复制链接 / 复制编号 / 在 Bug 列表中查看 / 归档 / 删除（进回收站），同需求详情 */
export function BugMoreMenu({ id, code, title, listHref, canEdit, canDelete }: { id: string; code: string; title: string; listHref: string; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const run = useLifecycle();

  async function copy(text: string, msg: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(msg);
    } catch {
      toast.error("复制失败，请手动复制");
    }
  }

  return (
    <ActionMenu
      label="Bug 更多操作"
      items={[
        { label: "复制链接", icon: Link2, onSelect: () => void copy(`${window.location.origin}/bugs/${id}`, "已复制链接") },
        { label: "复制编号", icon: Copy, onSelect: () => void copy(code, `已复制 ${code}`) },
        { label: "在 Bug 列表中查看", icon: List, onSelect: () => router.push(listHref) },
        ...(canEdit ? [{ label: "归档 Bug", icon: Archive, divider: true, onSelect: () => void run("bug", id, title, "archive", () => router.push(listHref)) }] : []),
        ...(canDelete ? [{ label: "删除 Bug", icon: Trash2, tone: "danger" as const, divider: !canEdit, onSelect: () => void run("bug", id, title, "delete", () => router.push(listHref)) }] : []),
      ]}
    />
  );
}
