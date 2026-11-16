import { getSession } from "@/lib/auth";
import { loadRecent } from "@pm-collab/core/docs/recent-query";
import { fmtAgo, pageDisplayTitle } from "@/lib/docs";
import { PageContext } from "@/components/layout/PageContext";
import { DocPageList } from "@/components/docs/DocPageList";

/** 文档 · 最近更新：我能看到的空间里最近有改动的页面 */
export default async function RecentDocsPage() {
  const user = await getSession();
  if (!user) return null;
  const pages = await loadRecent(user);
  return (
    <div className="page-overview">
      <PageContext crumbs={[{ label: "文档", href: "/docs" }, { label: "最近更新" }]} />
      <h1 className="page-title">最近更新</h1>
      <p className="page-summary">你参与的空间里最近新建或修改过的页面。</p>
      <section className="page-section">
        <DocPageList
          empty="还没有页面。进入一个空间，点「新建页面」开始写第一篇文档。"
          rows={pages.map((p) => {
            const who = p.updatedBy || p.creator;
            return {
              id: p.id,
              spaceId: p.projectId,
              title: pageDisplayTitle(p),
              sub: p.project.name,
              who: who.name,
              whoAvatar: who.avatarUrl,
              when: fmtAgo(p.updatedAt),
              draft: p.version === 0,
            };
          })}
        />
      </section>
    </div>
  );
}
