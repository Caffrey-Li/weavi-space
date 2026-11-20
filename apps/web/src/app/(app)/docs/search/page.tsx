import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { getSession } from "@/lib/auth";
import { searchDocs } from "@pm-collab/core/docs/search";
import { fmtAgo } from "@/lib/docs";
import { PageContext } from "@/components/layout/PageContext";

export const dynamic = "force-dynamic";

/** 摘要里的关键词加粗（先按关键词切开，再逐段渲染，不拼 HTML） */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="doc-search-hit">{part}</mark> : <span key={i}>{part}</span>))}
    </>
  );
}

/** 文档 · 搜索（T36）：按关键词搜我能看到的所有空间的文档标题和正文 */
export default async function DocSearchPage(props: { searchParams: Promise<{ q?: string; space?: string }> }) {
  const user = await getSession();
  if (!user) return null;
  const { q = "", space } = await props.searchParams;
  const { terms, hits } = q.trim() ? await searchDocs(user, { q, spaceId: space || null, limit: 50 }) : { terms: [], hits: [] };
  return (
    <div className="page-overview">
      <PageContext crumbs={[{ label: "文档", href: "/docs" }, { label: "搜索" }]} />
      <h1 className="page-title">搜索文档</h1>
      <p className="page-summary">搜你能看到的所有空间里已发布的文档，标题和正文都搜；多个词用空格分开，要同时出现。</p>
      <form role="search" action="/docs/search" className="doc-search-form">
        <Search size={16} aria-hidden="true" />
        <input type="search" name="q" defaultValue={q} className="input" placeholder="输入关键词，例如：登录 验证码" aria-label="搜索文档" autoFocus />
        {space ? <input type="hidden" name="space" value={space} /> : null}
        <button type="submit" className="btn-primary nv-head-btn">
          搜索
        </button>
      </form>
      {q.trim() ? (
        <section className="page-section" aria-live="polite">
          <div className="section-head">
            <h2 className="section-title">
              结果 <span className="section-count">{hits.length}</span>
            </h2>
          </div>
          {hits.length ? (
            <ul className="doc-list">
              {hits.map((h) => (
                <li key={h.id}>
                  <Link href={`/docs/${h.spaceId}/pages/${h.id}`} className="doc-list-row doc-search-row">
                    <FileText size={18} aria-hidden="true" className="doc-list-icon" />
                    <span className="doc-list-main">
                      <span className="doc-list-title">
                        <Highlight text={h.title} terms={terms} />
                      </span>
                      <span className="doc-search-snippet">
                        <Highlight text={h.snippet} terms={terms} />
                      </span>
                      <span className="doc-list-sub">{h.spaceName}</span>
                    </span>
                    <span className="doc-list-when">{fmtAgo(new Date(h.updatedAt))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-inline">没有找到包含「{terms.join(" ")}」的文档。换个词，或者少输几个词试试。</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
