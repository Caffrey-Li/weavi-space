"use client";

import { useEffect, useState } from "react";

type Opt = { id: string; name: string; code: string; enterpriseId?: string | null };
let cache: Promise<Opt[]> | null = null;

/** 「所属产品」下拉（选填）：未归档的产品 */
export function ProductSelect({ id, value, onChange, enterpriseId }: { id?: string; value: string; onChange: (v: string) => void; /** 系统管理员选了所属企业时，只列这个企业的产品 */ enterpriseId?: string }) {
  const [opts, setOpts] = useState<Opt[] | null>(null);
  useEffect(() => {
    cache ||= fetch("/api/meta", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { products?: Opt[] }) => d.products || [])
      .catch(() => {
        cache = null;
        return [];
      });
    let alive = true;
    void cache.then((list) => alive && setOpts(list));
    return () => {
      alive = false;
    };
  }, []);
  // 当前值不在列表里（产品已归档）时也显示出来，避免被静默清空
  const missing = value && opts && !opts.some((o) => o.id === value);
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={!opts}>
      <option value="">不关联产品</option>
      {missing ? <option value={value}>（当前产品已归档）</option> : null}
      {(opts || []).filter((o) => !enterpriseId || o.enterpriseId === enterpriseId || o.id === value).map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}（{o.code}）
        </option>
      ))}
    </select>
  );
}

/** 新建 / 删除产品后让下拉重新读取 */
export function resetProductOptions() {
  cache = null;
}
