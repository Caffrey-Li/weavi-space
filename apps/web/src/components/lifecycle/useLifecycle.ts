"use client";

import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { KIND_LABEL, lifecycle, type Kind } from "@/lib/lifecycle-shared";

const CASCADE: Partial<Record<Kind, string>> = {
  product: "它的项目，以及项目里的需求、Bug、文档",
  project: "项目里的需求、Bug、文档",
  doc: "子页面",
};

/**
 * 归档 / 删除的统一入口：先确认，再调用 /api/lifecycle，成功后提示并刷新。
 * 删除进入回收站（30 天内可恢复）；两者都可在「设置 › 归档与回收站」找回。
 */
export function useLifecycle() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  async function run(kind: Kind, id: string, name: string, action: "archive" | "unarchive" | "delete", after?: () => void) {
    const label = KIND_LABEL[kind];
    const extra = CASCADE[kind];
    if (action !== "unarchive") {
      const ok = await confirm(
        action === "archive"
          ? {
              title: `归档${label}「${name}」？`,
              body: `归档后不再出现在列表和看板里${extra ? `，${extra}会一起归档` : ""}。可以随时在「设置 › 归档与回收站」取消归档。`,
              confirmLabel: "归档",
            }
          : {
              title: `删除${label}「${name}」？`,
              body: `删除后移入回收站${extra ? `，${extra}会一起移入` : ""}。30 天内可以在「设置 › 归档与回收站」恢复，之后自动彻底删除。`,
              confirmLabel: "删除",
              tone: "danger",
            },
      );
      if (!ok) return false;
    }
    const err = await lifecycle(kind, id, action);
    if (err) {
      toast.error(err);
      return false;
    }
    toast.success(action === "archive" ? `已归档「${name}」` : action === "unarchive" ? `已取消归档「${name}」` : `已删除「${name}」，可在回收站恢复`);
    after?.();
    router.refresh();
    return true;
  }
  return run;
}
