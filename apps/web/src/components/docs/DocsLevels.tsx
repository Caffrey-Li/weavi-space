"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText, Package, Plus, Star } from "lucide-react";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { DocPageList, type DocListRow } from "./DocPageList";
import { openNewDoc } from "./NewDocDialog";

type Counts = { product: number; dev: number; project: number; other: number; total: number };
export type LevelProduct = { id: string; name: string; code: string; desc: string; spaceId: string; projectCount: number; counts: Counts };
export type LevelProject = {
  id: string;
  name: string;
  key: string;
  iconUrl: string | null;
  productName: string | null;
  counts: Counts;
  docs: { id: string; title: string; type: string; typeLabel: string }[];
};
export type LevelDoc = DocListRow & { type: "product" | "dev" | "project" | "other" };
type Tab = "product" | "project" | "doc";

const TYPE_TONE: Record<string, string> = { product: "is-purple", dev: "is-info", project: "is-neutral", other: "is-neutral" };
const TYPE_FILTERS: { key: "all" | "product" | "dev" | "project" | "other"; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "product", label: "产品文档" },
  { key: "dev", label: "开发文档" },
  { key: "project", label: "业务文档" },
  { key: "other", label: "其他" },
];
const countText = (c: Counts) => `产品文档 ${c.product} · 开发文档 ${c.dev} · 业务文档 ${c.project}${c.other ? ` · 其他 ${c.other}` : ""}`;

const STAR_KEY = "pm-doc-space-stars";
function useStars() {
  const [stars, setStars] = useState<string[]>([]);
  useEffect(() => {
    try {
      setStars(JSON.parse(window.localStorage.getItem(STAR_KEY) || "[]") as string[]);
    } catch {
      setStars([]);
    }
  }, []);
  const toggle = (id: string) =>
    setStars((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        window.localStorage.setItem(STAR_KEY, JSON.stringify(next));
      } catch {
        /* 存储不可用时只在本次生效 */
      }
      return next;
    });
  return { stars, toggle };
}

/** 所有空间（Figma 13 / 48 / 49）：标签 产品 / 项目 / 文档，各层级都能直接新建文档 */
export function DocsLevels({
  products,
  projects,
  docs,
  q,
  children,
}: {
  products: LevelProduct[];
  projects: LevelProject[];
  docs: LevelDoc[];
  q: string;
  /** 产品 / 项目标签下方的「最近更新」 */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const raw = sp.get("tab");
  const tab: Tab = raw === "project" || raw === "doc" ? raw : "product";
  const [type, setType] = useState<(typeof TYPE_FILTERS)[number]["key"]>("all");
  const { stars, toggle } = useStars();

  function go(t: Tab) {
    const next = new URLSearchParams(sp.toString());
    if (t === "product") next.delete("tab");
    else next.set("tab", t);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  }
  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: "product", label: "产品", n: products.length },
    { key: "project", label: "项目", n: projects.length },
    { key: "doc", label: "文档", n: docs.length },
  ];
  const star = (id: string, name: string) => {
    const on = stars.includes(id);
    return (
      <button type="button" className={`icon-button nv-space-star${on ? " is-on" : ""}`} aria-pressed={on} aria-label={on ? `取消星标「${name}」` : `星标「${name}」`} onClick={() => toggle(id)}>
        <Star size={16} aria-hidden="true" />
      </button>
    );
  };
  const empty = (what: string) => <p className="empty-inline">{q ? `没有名称包含「${q}」的${what}。` : `还没有可查看的${what}。`}</p>;
  const shownDocs = type === "all" ? docs : docs.filter((d) => d.type === type);

  return (
    <>
      <div className="nv-toolbar">
        <nav className="route-tabs" aria-label="按层级浏览">
          {tabs.map((t) => (
            <button key={t.key} type="button" className={`route-tab${tab === t.key ? " is-active" : ""}`} aria-pressed={tab === t.key} onClick={() => go(t.key)}>
              {t.label}
              <span className="route-tab-count">{t.n}</span>
            </button>
          ))}
        </nav>
      </div>
      <div className="nv-page-body">
        {tab === "product" ? (
          products.length ? (
            <div className="nv-space-grid">
              {products.map((p) => (
                <div key={p.id} className="nv-space-card">
                  <div className="nv-space-head">
                    <span className="nv-level-icon is-product" aria-hidden="true">
                      <Package size={18} />
                    </span>
                    <Link href={p.spaceId ? `/docs/${p.spaceId}` : `/products/${p.id}`} className="nv-space-title">
                      <span className="nv-space-name">{p.name}</span>
                      <span className="nv-space-key">{p.code}</span>
                    </Link>
                    {p.spaceId ? star(p.spaceId, p.name) : null}
                  </div>
                  <p className="nv-space-desc">{p.desc || "还没有产品描述"}</p>
                  <div className="nv-space-foot">
                    <span className="nv-space-pages">
                      {countText(p.counts)} · {p.projectCount} 个项目
                    </span>
                    {p.spaceId ? (
                      <button type="button" className="btn-ghost nv-head-btn" onClick={() => openNewDoc({ level: "product", spaceId: p.spaceId, groupKey: "product" })}>
                        <Plus size={14} aria-hidden="true" />
                        新建文档
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            empty("产品")
          )
        ) : null}

        {tab === "project" ? (
          projects.length ? (
            <div className="nv-space-grid">
              {projects.map((p) => (
                <div key={p.id} className="nv-space-card">
                  <div className="nv-space-head">
                    <ProjectIcon name={p.name} src={p.iconUrl} size={36} />
                    <Link href={`/docs/${p.id}`} className="nv-space-title">
                      <span className="nv-space-name">{p.name}</span>
                      <span className="nv-space-key">{p.key}</span>
                    </Link>
                    {star(p.id, p.name)}
                  </div>
                  <p className="nv-space-desc">所属产品 · {p.productName || "未归属产品"}</p>
                  {p.docs.length ? (
                    <ul className="nv-level-docs">
                      {p.docs.map((d) => (
                        <li key={d.id}>
                          <Link href={`/docs/${p.id}/pages/${d.id}`}>
                            <FileText size={14} aria-hidden="true" />
                            <span>{d.title}</span>
                            <span className={`nv-tag ${TYPE_TONE[d.type]}`}>{d.typeLabel}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="nv-space-meta">还没有文档</p>
                  )}
                  <div className="nv-space-foot">
                    <span className="nv-space-pages">{countText(p.counts)}</span>
                    <button type="button" className="btn-ghost nv-head-btn" onClick={() => openNewDoc({ level: "project", spaceId: p.id })}>
                      <Plus size={14} aria-hidden="true" />
                      新建文档
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            empty("项目")
          )
        ) : null}

        {tab === "doc" ? (
          <section className="nv-docs-recent" aria-labelledby="docs-all">
            <div className="nv-leader-section-head nv-level-doc-head">
              <h2 id="docs-all">全部文档</h2>
              <div className="nv-pform-seg nv-level-filter" role="group" aria-label="按文档类型筛选">
                {TYPE_FILTERS.map((f) => (
                  <button key={f.key} type="button" aria-pressed={type === f.key} onClick={() => setType(f.key)}>
                    {f.label} {f.key === "all" ? docs.length : docs.filter((d) => d.type === f.key).length}
                  </button>
                ))}
              </div>
              <span className="flex-1" />
              <button
                type="button"
                className="btn-secondary nv-head-btn"
                onClick={() => openNewDoc({ groupKey: type === "all" || type === "other" ? null : type })}
              >
                <Plus size={14} aria-hidden="true" />
                新建文档
              </button>
            </div>
            <DocPageList showName rows={shownDocs} empty={q ? `没有标题包含「${q}」的文档。` : "这个类型下还没有文档。"} />
            {docs.length >= 200 ? <p className="nv-set-hint">只显示最近更新的 200 篇，可以用右上角搜索查找更早的文档</p> : null}
          </section>
        ) : (
          children
        )}
      </div>
    </>
  );
}
