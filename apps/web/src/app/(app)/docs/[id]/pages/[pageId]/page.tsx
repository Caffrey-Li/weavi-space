import Link from "next/link";
import { DocContent } from "@/components/docs/DocContent";
import { notFound } from "next/navigation";
import { ArchivedBar } from "@/components/lifecycle/ArchivedBar";
import { FileText, Info, Pencil } from "lucide-react";
import { getSession } from "@/lib/auth";
import { pageRead } from "../../../../../../docs/pageRead-query";
import { docStatusTag, fmtAgo, fmtDay, pageDisplayTitle } from "@/lib/docs";
import { readingMinutes } from "@/lib/doc-html";
import { WorkHeader, type WorkCrumb } from "@/components/layout/WorkHeader";
import { Avatar, AvatarGroup } from "@/components/ui/Avatar";
import { DocPageActions, NewChildPageButton } from "@/components/docs/DocPageActions";
import { BoardView } from "@/components/docs/board/BoardView";
import { DeliveryShell, DeliveryToggle } from "@/components/docs/delivery/DeliveryShell";
import { CasesView, ExportPlaywrightButton } from "@/components/docs/delivery/CasesView";
import { deliveryBrief } from "@pm-collab/core/delivery/service";
import { docRequirements } from "@pm-collab/core/requirements/flow";
import { DocRequirementBar, ExtractRequirementsButton } from "@/components/requirements/RequirementFlow";
import { parseCasesBody } from "@pm-collab/core/shared/testcases";

/** 文档 · 页面阅读：面包屑 → 状态 / 关联 → 标题 → 作者信息 → 正文 → 关联需求与 Bug → 子页面；右侧本页目录 */
export default async function DocReadPage(props: { params: Promise<{ id: string; pageId: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return null;
  const data = await pageRead(session, params.id, params.pageId);
  if (data.state === "notFound") notFound();
  const { page, canEdit, ancestors, star, bodyRefs, linkRefs, refInfo, html, toc } = data;
  const title = pageDisplayTitle(page);
  const related = new Map<string, { kind: "req" | "bug"; id: string }>();
  for (const r of [...linkRefs, ...bodyRefs]) related.set(`${r.kind}:${r.id}`, r);
  const manual = page.links.filter((l) => l.source === "manual");
  const tag = docStatusTag(page.statusTag);
  const contributors = Array.from(new Set(page.versions.map((v) => v.author?.name).filter(Boolean) as string[]));
  const lastEditor = page.updatedBy || page.creator;
  const hasDraft = page.draftBody != null && page.version > 0;
  const base = `/docs/${page.projectId}/pages`;
  const delivery = page.kind === "board" ? null : await deliveryBrief(page.id);
  const owners = page.kind === "board" ? [] : await docRequirements(session, page.id);
  const showDelivery = page.kind !== "board" && (Boolean(delivery) || (canEdit && page.kind === "doc" && page.version > 0));
  const panelDefault = delivery ? "open" : "closed";
  const cases = page.kind === "testcases" ? parseCasesBody(page.body) : [];
  const crumbs: WorkCrumb[] = [
    { label: page.project.name, href: `/docs/${page.projectId}`, project: { name: page.project.name, iconUrl: page.project.iconUrl } },
    ...ancestors.map((a) => ({ label: a.title, href: `${base}/${a.id}`, icon: "file" as const })),
    { label: title },
  ];
  return (
    <div className="doc-read">
      <WorkHeader
        crumbs={crumbs}
        actions={
          <>
            {contributors.length ? (
              <span className="doc-contributors" aria-label={`参与编辑：${contributors.join("、")}`}>
                <AvatarGroup names={contributors} size={20} />
              </span>
            ) : null}
            {page.kind === "testcases" ? <ExportPlaywrightButton cases={cases} title={title} /> : null}
            {page.kind === "doc" && canEdit && page.version > 0 && !owners.length && delivery?.role !== "prd" ? <ExtractRequirementsButton pageId={page.id} /> : null}
            {showDelivery ? <DeliveryToggle defaultMode={panelDefault} /> : null}
            <DocPageActions
              spaceId={page.projectId}
              pageId={page.id}
              title={title}
              parentId={page.parentId}
              starred={Boolean(star)}
              canEdit={canEdit}
              noEdit={page.kind === "testcases"}
              childCount={page.children.length}
            />
          </>
        }
      />
      {page.archivedAt ? <ArchivedBar kind="doc" id={page.id} label="页面" canRestore={canEdit} /> : null}
      <DocRequirementBar items={owners} />
      {showDelivery ? (
        <DeliveryShell pageId={page.id} spaceId={page.projectId} defaultMode={panelDefault}>
          {body()}
        </DeliveryShell>
      ) : (
        body()
      )}
    </div>
  );

  function body() {
    return page.kind === "board" ? (
        <div className="nv-board-read">
          {hasDraft && canEdit ? (
            <div className="info-banner tone-info doc-draft-banner nv-board-draft" role="note">
              <Info size={18} aria-hidden="true" className="info-banner-icon" />
              <div className="info-banner-body">
                这个画布有未发布的修改（{fmtAgo(page.draftUpdatedAt)}保存），其他人看到的仍是已发布版本。{" "}
                <Link className="text-link" href={`${base}/${page.id}/edit`}>
                  继续编辑
                </Link>
              </div>
            </div>
          ) : null}
          {page.version === 0 ? (
            <div className="nv-board-empty">
              <p>这个画布还没有发布。</p>
              {canEdit ? (
                <Link className="btn-primary nv-head-btn" href={`${base}/${page.id}/edit`}>
                  <Pencil size={14} aria-hidden="true" />
                  去编辑
                </Link>
              ) : null}
            </div>
          ) : (
            <BoardView scene={page.body} title={title} />
          )}
        </div>
      ) : page.kind === "testcases" ? (
        <div className="doc-read-layout is-cases">
          <article className="doc-article">
            {tag ? (
              <div className="doc-meta-row">
                <span className={`doc-chip tone-${tag.tone}`}>
                  <span className="doc-dot" aria-hidden="true" />
                  {tag.label}
                </span>
              </div>
            ) : null}
            <h1 className="doc-title">{title}</h1>
            <p className="doc-byline-sub nv-cases-byline">
              {lastEditor.name} 最后更新于 {fmtAgo(page.publishedAt)} · 第 {page.version} 版 · {cases.length} 条用例 ·{" "}
              <Link className="text-link" href={`${base}/${page.id}/history`}>
                版本记录（{page.version}）
              </Link>
            </p>
            <CasesView cases={cases} pageId={page.id} deliveryId={delivery?.id ?? null} status={delivery?.casesStatus ?? "confirmed"} canEdit={canEdit} coverage={delivery?.coverage ?? null} basis={delivery?.basis ?? null} />
          </article>
        </div>
      ) : (

      <div className="doc-read-layout">
        <article className="doc-article">
          {hasDraft && canEdit ? (
            <div className="info-banner tone-info doc-draft-banner" role="note">
              <Info size={18} aria-hidden="true" className="info-banner-icon" />
              <div className="min-w-0 flex-1">
                <p className="info-banner-title">这个页面有未发布的修改</p>
                <div className="info-banner-body">
                  草稿保存于 {fmtAgo(page.draftUpdatedAt)}，发布前其他人看到的仍是下面的已发布版本。{" "}
                  <Link className="text-link" href={`${base}/${page.id}/edit`}>
                    继续编辑
                  </Link>
                </div>
              </div>
            </div>
          ) : null}

          {tag || manual.length ? (
            <div className="doc-meta-row">
              {tag ? (
                <span className={`doc-chip tone-${tag.tone}`}>
                  <span className="doc-dot" aria-hidden="true" />
                  {tag.label}
                </span>
              ) : null}
              {manual.map((l) => {
                const key = l.requirementId ? `req:${l.requirementId}` : `bug:${l.bugId}`;
                const info = refInfo.get(key);
                return info ? (
                  <Link key={l.id} href={info.href} className="doc-chip doc-link-chip" title={`${info.title} · ${info.status}`}>
                    {info.code}
                  </Link>
                ) : null;
              })}
            </div>
          ) : null}

          <h1 className="doc-title">{title}</h1>
          <div className="doc-byline">
            <Avatar name={page.creator.name} src={page.creator.avatarUrl} size={24} />
            <div>
              <p>
                {page.creator.name} 创建于 {fmtDay(page.createdAt)}
              </p>
              <p className="doc-byline-sub">
                {page.version > 0 ? (
                  <>
                    {lastEditor.name} 最后更新于{" "}
                    <time dateTime={page.publishedAt?.toISOString()} title={page.publishedAt ? page.publishedAt.toLocaleString("zh-CN", { hour12: false }) : undefined}>
                      {fmtAgo(page.publishedAt)}
                    </time>{" "}
                    · 第 {page.version} 版 · 阅读约 {readingMinutes(page.body)} 分钟 ·{" "}
                    <Link className="text-link" href={`${base}/${page.id}/history`}>
                      版本记录（{page.version}）
                    </Link>{" "}
                    · {page.viewCount + 1} 次查看
                  </>
                ) : (
                  "尚未发布"
                )}
              </p>
            </div>
          </div>

          {page.version === 0 ? (
            <div className="doc-empty">
              <FileText size={28} aria-hidden="true" />
              <p>这个页面还没有发布。{canEdit ? "继续编辑，写好后点「发布」，空间成员就能看到。" : ""}</p>
              {canEdit ? (
                <Link href={`${base}/${page.id}/edit`} className="btn-primary">
                  <Pencil size={14} aria-hidden="true" />
                  继续编辑
                </Link>
              ) : null}
            </div>
          ) : html ? (
            <DocContent html={html} />
          ) : (
            <p className="empty-inline">这个页面没有正文。</p>
          )}

          {related.size ? (
            <section className="doc-related" aria-labelledby="doc-related-title">
              <h2 id="doc-related-title" className="doc-section-title">
                关联需求与 Bug
              </h2>
              <ul className="doc-related-list">
                {Array.from(related.values()).map((r) => {
                  const info = refInfo.get(`${r.kind}:${r.id}`);
                  if (!info) return null;
                  return (
                    <li key={`${r.kind}:${r.id}`}>
                      <Link href={info.href} className="doc-related-row">
                        <span className="doc-ref-code">{info.code}</span>
                        <span className="doc-related-title">{info.title}</span>
                        <span className="doc-ref-status" data-tone={info.tone}>
                          {info.status}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section className="doc-related" aria-labelledby="doc-children-title">
            <div className="doc-section-head">
              <h2 id="doc-children-title" className="doc-section-title">
                子页面<span className="section-count">{page.children.length}</span>
              </h2>
              {canEdit ? <NewChildPageButton spaceId={page.projectId} parentId={page.id} label="新建子页面" /> : null}
            </div>
            {page.children.length ? (
              <ul className="doc-child-list">
                {page.children.map((c) => (
                  <li key={c.id}>
                    <Link href={`${base}/${c.id}`} className="doc-child-row">
                      <FileText size={16} aria-hidden="true" />
                      {pageDisplayTitle(c)}
                      {c.version === 0 ? <span className="doc-tree-draft">草稿</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-inline">没有子页面。</p>
            )}
          </section>
        </article>

        {toc.length > 1 ? (
          <nav className="doc-toc" aria-label="本页目录">
            <p className="doc-toc-title">本页目录</p>
            <ul>
              {toc.map((t) => (
                <li key={t.id} className={`lv-${t.level}`}>
                  <a href={`#${t.id}`}>{t.text}</a>
                </li>
              ))}
              {related.size ? (
                <li className="lv-2">
                  <a href="#doc-related-title">关联需求与 Bug</a>
                </li>
              ) : null}
            </ul>
          </nav>
        ) : null}
      </div>
      );
  }
}
