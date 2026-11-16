"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { PRODUCT_STATUS } from "@/lib/products";

/** 产品列表功能区（Figma 26）：搜索 220 + 负责人 200 + 状态 200，条件写进 URL */
export function ProductFilters({ owners }: { owners: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") || "");
  useEffect(() => setQ(sp.get("q") || ""), [sp]);

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <>
      <form
        role="search"
        className="nv-head-search is-static nv-prod-search"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q: q.trim() });
        }}
      >
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={q}
          placeholder="搜索产品名称或编码"
          aria-label="搜索产品名称或编码"
          enterKeyHint="search"
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value) apply({ q: "" });
          }}
        />
      </form>
      <select className="input nv-head-select" aria-label="负责人" value={sp.get("owner") || ""} onChange={(e) => apply({ owner: e.target.value })}>
        <option value="">全部负责人</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <select className="input nv-head-select" aria-label="状态" value={sp.get("status") || ""} onChange={(e) => apply({ status: e.target.value })}>
        <option value="">全部状态</option>
        {PRODUCT_STATUS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
    </>
  );
}
