"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PriorityBadge, ReqStatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";

type Item = {
  id: string;
  requirement: { id: string; title: string; status: string; priority: string };
};

export function ReleaseItemsTable({ items, emptyHint = "暂无关联需求" }: { items: Item[]; emptyHint?: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const slice = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  );

  return (
    <section className="card overflow-x-auto">
      <div className="border-b border-neutral-200 px-4 py-3 text-sm font-semibold">关联需求（{total}）</div>
      <table className="table-compact w-full min-w-[480px]">
        <thead>
          <tr>
            <th className="cell-title w-[55%]">标题</th>
            <th className="w-[25%]">状态</th>
            <th className="w-[20%]">优先级</th>
          </tr>
        </thead>
        <tbody>
          {slice.map((item) => (
            <tr key={item.id}>
              <td className="cell-title" title={item.requirement.title}>
                <Link href={`/requirements/${item.requirement.id}`} className="hover:text-brand-600" title={item.requirement.title}>
                  {item.requirement.title}
                </Link>
              </td>
              <td><ReqStatusBadge status={item.requirement.status} /></td>
              <td><PriorityBadge priority={item.requirement.priority} /></td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={3} className="py-6 text-center text-neutral-500">{emptyHint}</td></tr>
          )}
        </tbody>
      </table>
      {total > 0 && (
        <div className="border-t border-neutral-100 px-3">
          <Pagination
            total={total}
            page={safePage}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
        </div>
      )}
    </section>
  );
}
