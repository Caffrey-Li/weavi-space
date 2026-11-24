"use client";

import { useEffect, useState } from "react";
import { ExternalLink, LayoutTemplate, Palette } from "lucide-react";

type Item = { id: string; kind: string; source: string; title: string; meta: string; href: string; url?: string; note: string | null };

/**
 * T58 需求文档里的「原型与设计」：显示所属需求的原型（HTML 缩略图，点开沙箱预览）和 UI 设计稿地址。
 * 数据来自需求资料（/api/requirements/:id/artifacts），和需求页同一份。
 */
export function DocDesignStrip({ requirementIds }: { requirementIds: string[] }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const key = requirementIds.join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    Promise.all(
      key.split(",").map((id) =>
        fetch(`/api/requirements/${id}/artifacts`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : { items: [] }))
          .then((d: { items?: Item[] }) => d.items || [])
          .catch(() => [] as Item[]),
      ),
    ).then((lists) => {
      if (!alive) return;
      const seen = new Set<string>();
      setItems(lists.flat().filter((x) => (x.kind === "prototype" || x.kind === "ui") && !seen.has(x.id) && (seen.add(x.id), true)));
    });
    return () => {
      alive = false;
    };
  }, [key]);
  if (!items?.length) return null;
  return (
    <section className="nv-dds" aria-label="原型与设计">
      <h2 className="nv-dds-title">原型与设计</h2>
      <div className="nv-dds-grid">
        {items.map((x) => {
          const htmlFile = x.kind === "prototype" && x.source === "file" && /HTML/.test(x.meta);
          // 11-23：线上地址（Figma 等）直接在新页签打开原地址，不经过系统预览页
          const figma = x.source === "link" && /figma\.com/.test(x.url || x.href);
          return (
            <a key={x.id} className="nv-dds-card" href={x.source === "link" ? x.url || x.href : x.href} target={x.source === "link" ? "_blank" : undefined} rel="noreferrer">
              <span className="nv-dds-thumb">
                {htmlFile ? (
                  <iframe src={`/api/artifact-raw/${x.id}`} title={x.title} sandbox="allow-scripts" tabIndex={-1} />
                ) : figma ? (
                  <Palette size={28} aria-hidden="true" />
                ) : (
                  <LayoutTemplate size={28} aria-hidden="true" />
                )}
              </span>
              <span className="nv-dds-name">
                {x.title}
                {x.source === "link" ? <ExternalLink size={12} aria-hidden="true" /> : null}
              </span>
              <span className="nv-dds-meta">
                {x.kind === "prototype" ? "原型" : "UI 设计"}
                {x.note ? ` · ${x.note}` : ""} · {htmlFile ? "点击预览" : figma ? "在 Figma 中打开" : "点击打开"}
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}
