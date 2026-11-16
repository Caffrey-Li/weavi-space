import { getSession } from "@/lib/auth";
import { loadStars } from "@pm-collab/core/docs/starred-query";
import { fmtAgo, pageDisplayTitle } from "@/lib/docs";
import { PageContext } from "@/components/layout/PageContext";
import { DocPageList } from "@/components/docs/DocPageList";

/** 文档 · 加星标：我加了星标的页面 */
export default async function StarredDocsPage() {
  const user = await getSession();
  if (!user) return null;
  const stars = await loadStars(user);
  return (
    <div className="page-overview">
      <PageContext crumbs={[{ label: "文档", href: "/docs" }, { label: "加星标" }]} />
      <h1 className="page-title">加星标</h1>
      <p className="page-summary">在页面右上角点星标，常用页面会出现在这里。</p>
      <section className="page-section">
        <DocPageList
          empty="还没有加星标的页面。"
          rows={stars.map(({ page: p }) => {
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
