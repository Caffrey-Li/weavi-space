"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, Folder, Layers, Link2, Pencil, Trash2 } from "lucide-react";
import { ActionMenu, type ActionItem } from "@/components/ui/ActionMenu";
import { useLifecycle } from "@/components/lifecycle/useLifecycle";
import { ProductFormModal, type ProductFormValues } from "./ProductForm";
import { notifyProductsChanged } from "./ProductNav";

function useProductOps(id: string, name: string) {
  const router = useRouter();
  const run = useLifecycle();
  // 归档 / 删除都会连同产品下的项目、需求、Bug、文档一起处理，可在「设置 › 归档与回收站」恢复
  async function setStatus(status: string) {
    if (await run("product", id, name, status === "archived" ? "archive" : "unarchive")) notifyProductsChanged();
  }
  async function remove(_linked: number, after?: () => void) {
    if (await run("product", id, name, "delete", after)) notifyProductsChanged();
  }
  return { setStatus, remove, router };
}

/** 产品列表行的「⋯」（Figma 26 行菜单）：编辑产品信息、维护功能结构、关联项目 ─ 归档 / 恢复、删除产品 */
export function ProductRowMenu({
  id,
  name,
  status,
  linked,
  initial,
}: {
  id: string;
  name: string;
  status: string;
  linked: number;
  initial: ProductFormValues;
}) {
  const [open, setOpen] = useState(false);
  const { setStatus, remove, router } = useProductOps(id, name);
  const items: ActionItem[] = [
    { label: "编辑产品信息", icon: Pencil, onSelect: () => setOpen(true) },
    { label: "维护功能结构", icon: Layers, onSelect: () => router.push(`/products/${id}?tab=structure`) },
    { label: "关联项目", icon: Link2, onSelect: () => setOpen(true) },
    status === "archived"
      ? { label: "取消归档", icon: ArchiveRestore, divider: true, onSelect: () => void setStatus("maintaining") }
      : { label: "归档", icon: Folder, divider: true, onSelect: () => void setStatus("archived") },
    { label: "删除产品", icon: Trash2, tone: "danger", onSelect: () => void remove(linked) },
  ];
  return (
    <>
      <ActionMenu label={`「${name}」的更多操作`} items={items} />
      <ProductFormModal open={open} productId={id} initial={initial} onClose={() => setOpen(false)} />
    </>
  );
}

/** 产品详情页头：编辑产品信息 + ⋯（归档 / 删除） */
export function ProductActions({
  id,
  name,
  status,
  linked,
  initial,
}: {
  id: string;
  name: string;
  status: string;
  linked: number;
  initial: ProductFormValues;
}) {
  const [open, setOpen] = useState(false);
  const { setStatus, remove, router } = useProductOps(id, name);
  return (
    <>
      <button type="button" className="btn-secondary nv-head-btn" onClick={() => setOpen(true)}>
        产品信息
      </button>
      <ActionMenu
        label="产品的更多操作"
        items={[
          status === "archived"
            ? { label: "取消归档", onSelect: () => void setStatus("maintaining") }
            : { label: "归档产品", onSelect: () => void setStatus("archived") },
          { label: "删除产品", tone: "danger", onSelect: () => void remove(linked, () => router.push("/products")) },
        ]}
      />
      <ProductFormModal open={open} productId={id} initial={initial} onClose={() => setOpen(false)} />
    </>
  );
}
