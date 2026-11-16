"use client";

import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { useLifecycle } from "@/components/lifecycle/useLifecycle";

/** 项目概览页头「⋯」：归档 / 取消归档、删除项目（连同需求、Bug、文档进回收站） */
export function ProjectLifecycleMenu({ id, name, status }: { id: string; name: string; status: string }) {
  const router = useRouter();
  const run = useLifecycle();
  const archived = status === "archived";
  return (
    <ActionMenu
      label="项目更多操作"
      items={[
        archived
          ? { label: "取消归档", icon: ArchiveRestore, onSelect: () => void run("project", id, name, "unarchive") }
          : { label: "归档项目", icon: Archive, onSelect: () => void run("project", id, name, "archive", () => router.push("/projects")) },
        { label: "删除项目", icon: Trash2, tone: "danger", onSelect: () => void run("project", id, name, "delete", () => router.push("/projects")) },
      ]}
    />
  );
}
