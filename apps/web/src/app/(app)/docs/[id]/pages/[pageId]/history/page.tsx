import Link from "next/link";
import { DocContent } from "@/components/docs/DocContent";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { historyData } from "../../../../../../../docs/historyData-query";
import { fmtAgo, pageDisplayTitle } from "@/lib/docs";
import { PageContext } from "@/components/layout/PageContext";
import { Avatar } from "@/components/ui/Avatar";
import { DocRestoreButton } from "@/components/docs/DocRestoreButton";

/** 完整时间：2026-11-05 14:03 */
function fmtFull(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 文档 · 历史版本：每次发布（或恢复）留一版，记录版本号、更新人、更新时间。
 * ?v=N 查看某一版；&view=diff 与上一版逐段对比；有编辑权限时可以把旧版本恢复成新的一版。
 */
export default async function DocHistoryPage(
  props: {
    params: Promise<{ id: string; pageId: string }>;
    searchParams: Promise<{ v?: string; view?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const session = await getSession();
  if (!session) return null;
  const data = await historyData(session, params.id, params.pageId, searchParams);
  if (data.state === "notFound") notFound();
  const { page, ancestors, canEdit, restoredFrom, selected, previous, diffMode, rendered, diff, titleChanged } = data;
  const base = `/docs/${page.projectId}/pages/${page.id}`;
  const historyHref = `${base}/history`;
  const hasDraft = page.draftBody != null;
  const isCurrent = selected?.version === page.version;
  return (
    <div className="page-overview is-wide">
      <PageContext
        crumbs={[
          { label: page.project.name, href: `/docs/${page.projectId}` },
          ...ancestors.map((a) => ({ label: a.title, href: `/docs/${page.projectId}/pages/${a.id}` })),
          { label: pageDisplayTitle(page), href: base },
          { label: "历史版本" },
        ]}
      />
      <h1 className="page-title">历史版本</h1>
      <p className="page-summary">
        「{pageDisplayTitle(page)}」每次发布都会留下一个版本，共 {page.versions.length} 个。可以查看、和上一版对比，也可以恢复成新的一版。{" "}
        <Link className="text-link" href={base}>
          返回页面
        </Link>
      </p>
      <div className="doc-history">
        <ul className="doc-list doc-history-list">
          {page.versions.map((v) => {
            const active = selected?.id === v.id;
            const from = restoredFrom.get(v.version);
            return (
              <li key={v.id}>
                <Link
                  href={`${historyHref}?v=${v.version}${diffMode ? "&view=diff" : ""}`}
                  className={`doc-list-row${active ? " is-active" : ""}`}
                  aria-current={active ? "true" : undefined}
                >
                  <span className="doc-version">v{v.version}</span>
                  <span className="doc-list-main">
                    <span className="doc-list-title">
                      {v.title}
                      {v.version === page.version ? <span className="doc-version-tag">当前</span> : null}
                      {from ? <span className="doc-version-tag is-muted">恢复自 v{from}</span> : null}
                    </span>
                    <span className="doc-list-sub" title={fmtFull(v.createdAt)}>
                      {v.author?.name || "—"} · {fmtFull(v.createdAt)}
                    </span>
                  </span>
                  {v.author ? <Avatar name={v.author.name} src={v.author.avatarUrl} size={18} /> : null}
                </Link>
              </li>
            );
          })}
          {!page.versions.length ? <li className="empty-inline">还没有发布过。</li> : null}
        </ul>
        <div className="doc-history-view">
          {selected ? (
            <>
              <div className="doc-history-head">
                <div className="min-w-0">
                  <p className="doc-history-meta">
                    <span className="doc-version">v{selected.version}</span>
                    {selected.author ? <Avatar name={selected.author.name} src={selected.author.avatarUrl} size={18} /> : null}
                    <span>
                      {selected.author?.name || "—"} 更新于 {fmtFull(selected.createdAt)}（{fmtAgo(selected.createdAt)}）
                    </span>
                    {restoredFrom.get(selected.version) ? <span className="doc-version-tag is-muted">恢复自 v{restoredFrom.get(selected.version)}</span> : null}
                  </p>
                </div>
                <div className="doc-history-acts">
                  <nav className="segmented" aria-label="查看方式">
                    <Link href={`${historyHref}?v=${selected.version}`} className={`segmented-item${diffMode ? "" : " segmented-item-active"}`} aria-current={diffMode ? undefined : "page"}>
                      内容
                    </Link>
                    <Link href={`${historyHref}?v=${selected.version}&view=diff`} className={`segmented-item${diffMode ? " segmented-item-active" : ""}`} aria-current={diffMode ? "page" : undefined}>
                      与上一版对比
                    </Link>
                  </nav>
                  {canEdit && !isCurrent && !page.archivedAt ? <DocRestoreButton pageId={page.id} version={selected.version} hasDraft={hasDraft} historyHref={historyHref} /> : null}
                </div>
              </div>

              {diff ? (
                <>
                  <p className="doc-diff-summary">
                    {previous ? `对比 v${previous.version} → v${selected.version}` : "这是第一个版本，和空白页面对比"}：新增 {diff.added} 段，删除 {diff.removed} 段
                    {titleChanged ? `；标题由「${previous!.title}」改为「${selected.title}」` : ""}
                  </p>
                  {diff.added || diff.removed ? (
                    <ol className="doc-diff" aria-label="正文差异">
                      {diff.lines.map((l, i) => (
                        <li key={i} className={`doc-diff-line is-${l.kind}`}>
                          <span className="doc-diff-mark" aria-label={l.kind === "add" ? "新增" : l.kind === "del" ? "删除" : undefined}>
                            {l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}
                          </span>
                          <span className="doc-diff-text">{l.text}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="empty-inline">正文文字没有变化{titleChanged ? "，只改了标题" : "（可能只改了格式或图片）"}。</p>
                  )}
                </>
              ) : rendered ? (
                <>
                  <h2 className="doc-title is-small">{selected.title}</h2>
                  {rendered.html ? <DocContent html={rendered.html} /> : <p className="empty-inline">这个版本没有正文。</p>}
                </>
              ) : null}
            </>
          ) : (
            <p className="empty-inline">页面发布后，这里会出现版本记录。</p>
          )}
        </div>
      </div>
    </div>
  );
}
