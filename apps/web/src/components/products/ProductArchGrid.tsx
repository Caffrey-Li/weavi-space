"use client";

import { useState } from "react";
import Link from "next/link";
import { ImageOff, Plus } from "lucide-react";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { archTypeLabel } from "@/lib/product-arch";
import { fmtDate } from "@/lib/utils";
import { ArchFormModal } from "./ArchFormModal";

export type ArchCard = { id: string; type: string; name: string; imageId: string | null; updatedAt: string };

/** 架构展示（Figma 62）：卡片网格，点卡片进详情 */
export function ProductArchGrid({ productId, canManage, items }: { productId: string; canManage: boolean; items: ArchCard[] }) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <WorkHeader
        crumbs={[{ label: "架构展示" }]}
        count={items.length}
        actions={
          canManage ? (
            <button type="button" className="btn-primary nv-head-btn" onClick={() => setCreating(true)}>
              <Plus size={14} aria-hidden="true" />
              新建架构图
            </button>
          ) : null
        }
      />
      <div className="nv-pdetail-body">
        {items.length ? (
          <div className="nv-parch-grid">
            {items.map((a) => (
              <Link key={a.id} href={`/products/${productId}/architecture/${a.id}`} className="nv-parch-card">
                <span className="nv-parch-thumb">
                  {a.imageId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/attachments/${a.imageId}`} alt="" loading="lazy" />
                  ) : (
                    <ImageOff size={20} aria-hidden="true" />
                  )}
                </span>
                <span className="nv-parch-info">
                  <b>{a.name}</b>
                  <span className="nv-parch-meta">
                    <span className="nv-tag is-info">{archTypeLabel(a.type)}</span>
                    <span className="nv-pdetail-meta">{fmtDate(a.updatedAt)} 更新</span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="nv-pdetail-empty is-padded">{canManage ? "还没有架构图，点右上角「新建架构图」上传产品架构、系统架构或数据库表结构。" : "还没有架构图。"}</p>
        )}
      </div>
      <ArchFormModal open={creating} productId={productId} arch={null} onClose={() => setCreating(false)} />
    </>
  );
}
