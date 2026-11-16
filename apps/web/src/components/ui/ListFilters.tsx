"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Filter, Search, X } from "lucide-react";

export type FilterSelect = {
  name: string;
  /** 读屏用的字段名 */
  label: string;
  value: string;
  /** 第一项「全部…」的文案 */
  allLabel: string;
  options: { value: string; label: string }[];
};

/**
 * 通用列表工具栏（Plane 稿）：搜索框（回车提交）+ 若干筛选下拉（选择即生效）。
 * 用 GET 表单驱动 URL；hidden 里的参数会被保留，页码自动回到第 1 页。
 */
export function ListFilters({
  ariaLabel,
  search,
  selects = [],
  hidden = {},
  hasFilters = false,
  clearHref,
  children,
}: {
  ariaLabel: string;
  search?: { name: string; value: string; placeholder: string };
  selects?: FilterSelect[];
  hidden?: Record<string, string | undefined>;
  hasFilters?: boolean;
  clearHref?: string;
  children?: React.ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState(search?.value ?? "");
  const submit = () => form.current?.requestSubmit();

  return (
    <form ref={form} className="req-filters" role="search" aria-label={ariaLabel}>
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {search ? (
        <div className="search-field">
          <Search size={16} aria-hidden="true" className="search-field-icon" />
          <input
            name={search.name}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={search.placeholder}
            aria-label={search.placeholder}
            className="input search-field-input"
            enterKeyHint="search"
          />
          {query ? (
            <button
              type="button"
              className="search-field-clear"
              aria-label="清除搜索"
              onClick={() => {
                setQuery("");
                requestAnimationFrame(submit);
              }}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
      {selects.map((s) => (
        <label key={s.name} className="select-field">
          <Filter size={14} aria-hidden="true" className="select-field-icon" />
          <span className="sr-only">{s.label}</span>
          <select name={s.name} defaultValue={s.value} className="input select-field-input" onChange={submit}>
            <option value="">{s.allLabel}</option>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {children}
      {hasFilters && clearHref ? (
        <Link href={clearHref} className="btn-ghost req-clear">
          清除筛选
        </Link>
      ) : null}
    </form>
  );
}
