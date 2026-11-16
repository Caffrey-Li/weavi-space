"use client";

import { refreshDocsTree } from "@/components/docs/DocsNav";
import { notifyProductsChanged } from "@/components/products/ProductNav";
import { DatePicker } from "@/components/ui/DatePicker";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { ProductSelect } from "./ProductSelect";
import { EnterpriseSelect, useEnterprises } from "./EnterpriseSelect";

const EMPTY = {
  name: "",
  key: "",
  systemName: "",
  description: "",
  plannedEndAt: "",
  productId: "",
};

export function NewProjectButton({
  className = "btn-primary",
  label = "新建项目",
  afterCreate = "project",
  productId = "",
}: {
  className?: string;
  /** 文档模块里叫「新建空间」：空间就是项目 */
  label?: string;
  afterCreate?: "project" | "space";
  /** 在产品下新建时预选所属产品 */
  productId?: string;
} = {}) {
  const router = useRouter();
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const start = { ...EMPTY, productId };
  const [form, setForm] = useState(start);

  // 只有系统管理员拿得到企业列表。默认：预选产品的企业，否则第一个企业
  const { enterprises, products } = useEnterprises(open);
  const [enterpriseId, setEnterpriseId] = useState("");
  useEffect(() => {
    if (!enterprises.length || enterpriseId) return;
    setEnterpriseId(products.find((p) => p.id === form.productId)?.enterpriseId || enterprises[0].id);
  }, [enterprises, products, enterpriseId, form.productId]);
  function pickEnterprise(id: string) {
    setEnterpriseId(id);
    // 换企业后，已选的别的企业的产品不再有效
    if (products.find((p) => p.id === form.productId)?.enterpriseId !== id) setForm((f) => ({ ...f, productId: "" }));
  }

  const dirty = (Object.keys(EMPTY) as (keyof typeof EMPTY)[]).some((k) => form[k] !== start[k]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, enterpriseId: enterpriseId || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "创建失败");
      return;
    }
    setOpen(false);
    setForm(start);
    // 先跳转再刷新：refresh 放在 push 之前会被导航打断，侧栏项目列表等布局数据就不会更新
    if (data.id) router.push(afterCreate === "space" ? `/docs/${data.id}` : `/projects/${data.id}`);
    router.refresh();
    // 文档侧栏空间树、产品侧栏是各自请求的数据，单独通知它们重新读取
    refreshDocsTree();
    if (form.productId) notifyProductsChanged();
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        wide
        dirty={dirty}
        busy={saving}
      >
        <form onSubmit={submit} className="space-y-3">
          {error ? (
            <div role="alert" className="banner-error" tabIndex={-1}>
              {error}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${baseId}-name`} label="项目名称" required>
              <input
                className="input"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field id={`${baseId}-key`} label="标识" required>
              <input
                className="input font-mono uppercase"
                required
                placeholder="如 PAY"
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase() })}
              />
            </Field>
          </div>
          {enterprises.length ? (
            <Field id={`${baseId}-enterprise`} label="所属企业" hint="只有系统管理员能看到，其他人新建的项目自动归到自己的企业">
              <EnterpriseSelect value={enterpriseId} options={enterprises} onChange={pickEnterprise} />
            </Field>
          ) : null}
          <Field id={`${baseId}-product`} label="所属产品" hint="选填。只能选所属企业下的产品；关联后需求可以挂到产品的功能模块">
            <ProductSelect value={form.productId} enterpriseId={enterpriseId || undefined} onChange={(v) => setForm({ ...form, productId: v })} />
          </Field>
          <Field id={`${baseId}-system`} label="系统名称" required>
            <input
              className="input"
              required
              value={form.systemName}
              onChange={(e) => setForm({ ...form, systemName: e.target.value })}
            />
          </Field>
          <Field id={`${baseId}-date`} label="计划完成">
            <DatePicker id={`${baseId}-date`} value={form.plannedEndAt} onChange={(v) => setForm({ ...form, plannedEndAt: v })} />
          </Field>
          <Field id={`${baseId}-desc`} label="描述">
            <textarea
              className="input min-h-[64px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={saving}>
              取消
            </button>
            <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving || undefined}>
              {saving ? "创建中…" : "创建"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
