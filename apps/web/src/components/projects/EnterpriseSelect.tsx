"use client";

import { useEffect, useState } from "react";

export type EnterpriseOpt = { id: string; name: string };
type Meta = { enterprises: EnterpriseOpt[]; products: { id: string; enterpriseId?: string | null }[] };

/** 企业列表：接口只给系统管理员返回，其他人是空数组，选择入口也就不显示 */
export function useEnterprises(enabled = true) {
  const [meta, setMeta] = useState<Meta>({ enterprises: [], products: [] });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/meta", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: Partial<Meta>) => alive && setMeta({ enterprises: d.enterprises || [], products: d.products || [] }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled]);
  return meta;
}

/** 「所属企业」下拉（Figma 29 / 42 / 64）：外层的字段由调用方包，保持和所在表单一致 */
export function EnterpriseSelect({ id, value, options, onChange }: { id?: string; value: string; options: EnterpriseOpt[]; onChange: (v: string) => void }) {
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {!value ? <option value="">未归属（只有系统管理员可见）</option> : null}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
