"use client";

import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export type PaginationProps = {
  total: number;
  page: number;
  pageSize: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  /** When true, sync page/pageSize to URL searchParams (keeps other params). */
  syncUrl?: boolean;
  className?: string;
};


export function Pagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  syncUrl = false,
  className = "",
}: PaginationProps) {
  const router = useRouter();
  const pathname = usePathname();

  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  function pushUrl(nextPage: number, nextSize: number) {
    const sp = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    if (nextPage <= 1) sp.delete("page");
    else sp.set("page", String(nextPage));
    if (nextSize === 100) sp.delete("pageSize");
    else sp.set("pageSize", String(nextSize));
    const q = sp.toString();
    router.push(q ? `${pathname}?${q}` : pathname);
  }

  function goPage(p: number) {
    const next = Math.min(Math.max(1, p), totalPages);
    if (syncUrl) pushUrl(next, pageSize);
    onPageChange?.(next);
  }

  function changeSize(size: number) {
    if (syncUrl) pushUrl(1, size);
    onPageSizeChange?.(size);
  }

  if (total === 0 && !syncUrl) {
    return null;
  }

  return (
    <nav className={`pagination ${className}`} aria-label="分页">
      <p className="pagination-summary" aria-live="polite">
        {total > 0 ? `第 ${from}–${to} 条，共 ${total} 条` : "共 0 条"}
      </p>
      <div className="pagination-controls">
        <label className="pagination-size">
          <span className="sr-only">每页条数</span>
          <select className="input" value={pageSize} onChange={(e) => changeSize(Number(e.target.value))}>
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} 条 / 页
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="icon-button"
          aria-label="上一页"
          disabled={safePage <= 1}
          onClick={() => goPage(safePage - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="pagination-page" aria-current="page">
          {safePage} / {totalPages}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="下一页"
          disabled={safePage >= totalPages}
          onClick={() => goPage(safePage + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  );
}
