import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { spaceData } from "../../../../docs/spaceData-query";
import { fmtAgo, pageDisplayTitle } from "@/lib/docs";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { ProjectResources } from "@/components/projects/ProjectResources";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { SpaceStarButton } from "@/components/docs/SpaceGrid";
import { Avatar } from "@/components/ui/Avatar";
import { DocPageList } from "@/components/docs/DocPageList";
import { NewChildPageButton } from "@/components/docs/DocPageActions";

/** 文档 · 空间首页：空间头 → 快捷链接（项目资料）→ 最近更新 + 空间成员 */
export default async function SpacePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return null;
  const data = await spaceData(session, params.id);
  if (data.state === "notFound") notFound();
  const { p, perms, recent, parents, product, memberCanEdit, childSpaces, spaceName } = data;
  const titleOf = new Map(parents.map((x) => [x.id, x.title]));
  const isProduct = p.status === "space";
  const title = isProduct ? `${p.name} · 产品资料` : p.name;
  return (
    <div className="nv-page-flush">
      <WorkHeader
        crumbs={[
          isProduct ? { label: title, href: `/docs/${p.id}`, icon: "book" as const } : { label: p.name, href: `/docs/${p.id}`, project: { name: p.name, iconUrl: p.iconUrl } },
          { label: "空间概览" },
        ]}
        actions={
          <>
            <SpaceStarButton id={p.id} name={p.name} />
            {perms["docs.edit"] ? <NewChildPageButton spaceId={p.id} className="btn-primary nv-head-btn" /> : null}
          </>
        }
      />
      <div className="nv-page-body">
      <div className="nv-space-home">
      <header className="nv-space-hero">
        <ProjectIcon name={p.name} src={p.iconUrl} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="page-title">{title}</h1>
          <p className="page-summary">{p.description || p.systemName}</p>
          {isProduct ? (
            <p className="nv-space-meta">
              <span className="nv-tag is-purple">产品空间</span> {p._count.docPages} 个页面 · 所属产品{" "}
              {product ? (
                <Link href={`/products/${product.id}`} className="text-link">
                  {product.name}
                </Link>
              ) : (
                "—"
              )}
              {product?.owner ? ` · 负责人 ${product.owner.name}` : ""}
            </p>
          ) : (
            <p className="nv-space-meta">
              <span className="nv-tag is-info">项目空间</span> 空间标识 {p.key} · {p.members.length} 位成员 · {p._count.docPages} 个页面 ·
              关联项目{" "}
              <Link href={`/projects/${p.id}`} className="text-link">
                {p.name}
              </Link>
            </p>
          )}
        </div>
      </header>

      <div id="links" className="doc-anchor">
        <ProjectResources
          projectId={p.id}
          resources={p.resources.map((r) => ({ id: r.id, name: r.name, url: r.url, sortOrder: r.sortOrder }))}
          canEdit={perms["project.edit"]}
          title="快捷链接"
          addLabel="添加链接"
        />
      </div>

      <div className="doc-space-cols">
        <section className="page-section" aria-labelledby="space-recent">
          <div className="section-head">
            <h2 id="space-recent" className="section-title">
              最近更新
            </h2>
          </div>
          <DocPageList
            empty={perms["docs.edit"] ? "这个空间还没有页面，点右上角「新建页面」开始。" : "这个空间还没有页面。"}
            rows={recent.map((d) => {
              const who = d.updatedBy || d.creator;
              return {
                id: d.id,
                spaceId: d.projectId,
                title: pageDisplayTitle(d),
                sub: `${d.projectId !== p.id ? `${spaceName.get(d.projectId) || ""} · ` : ""}${d.parentId ? titleOf.get(d.parentId) || "" : "空间根目录"}`,
                who: who.name,
                whoAvatar: who.avatarUrl,
                when: fmtAgo(d.updatedAt),
                draft: d.version === 0,
              };
            })}
          />
        </section>

        {isProduct ? (
          <section className="page-section" aria-labelledby="space-projects">
            <div className="section-head">
              <h2 id="space-projects" className="section-title">
                下属项目的文档<span className="section-count">{childSpaces.length}</span>
              </h2>
            </div>
            <ul className="doc-member-list">
              {childSpaces.map((x) => (
                <li key={x.id} className="nv-child-space">
                  <div className="nv-child-space-head">
                    <ProjectIcon name={x.name} src={x.iconUrl} size={20} />
                    <Link href={`/docs/${x.id}`} className="nv-member-name">
                      {x.name}
                    </Link>
                    <span className="nv-member-role">{x.count} 篇文档</span>
                  </div>
                  {x.top.length ? (
                    <ul className="nv-child-space-docs">
                      {x.top.map((d) => (
                        <li key={d.id}>
                          <Link className="text-link" href={`/docs/${x.id}/pages/${d.id}`}>
                            {pageDisplayTitle(d)}
                          </Link>
                          <span>{fmtAgo(d.updatedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
              {product?.projects.length ? null : <li className="text-tertiary">还没有项目关联到这个产品。</li>}
            </ul>
          </section>
        ) : (
        <section className="page-section" aria-labelledby="space-members">
          <div className="section-head">
            <h2 id="space-members" className="section-title">
              空间成员<span className="section-count">{p.members.length}</span>
            </h2>
          </div>
          <ul className="doc-member-list">
            {p.members.map((m, i) => (
              <li key={m.id}>
                <Avatar name={m.user.name} src={m.user.avatarUrl} size={22} />
                <span className="nv-member-name">{m.user.name}</span>
                <span className="nv-member-role">{memberCanEdit[i] ? "可编辑" : "仅查看"}</span>
              </li>
            ))}
          </ul>
        </section>
        )}
      </div>
      </div>
      </div>
    </div>
  );
}
