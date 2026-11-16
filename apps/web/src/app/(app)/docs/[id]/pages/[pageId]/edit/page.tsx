import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadEdit } from "@pm-collab/core/docs/edit-query";
import { DOC_STATUS_TAGS, ancestorsOf, canEditDocs, canViewSpace, loadRefInfo, pageDisplayTitle } from "@/lib/docs";
import { extractRefs, renderDocHtml } from "@/lib/doc-html";
import { PageContext } from "@/components/layout/PageContext";
import { DocEditor } from "@/components/docs/DocEditor";
import { BoardEditor } from "@/components/docs/board/BoardEditor";

/** 文档 · 页面编辑：固定工具栏 + 「/」插入菜单，自动保存草稿，「发布」后成为新版本 */
export default async function DocEditPage(props: { params: Promise<{ id: string; pageId: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return null;
  const page = await loadEdit(params.pageId);
  if (!page || page.projectId !== params.id || page.deletedAt || page.archivedAt) notFound();
  if (!(await canViewSpace(session, page.projectId)) || !(await canEditDocs(session, page.projectId))) {
    redirect(`/docs/${page.projectId}/pages/${page.id}`);
  }

  // 测试用例页在用例表和需求交付面板里改，不进富文本编辑器
  if (page.kind === "testcases") redirect(`/docs/${page.projectId}/pages/${page.id}`);

  if (page.kind === "board") {
    const ancestorsB = await ancestorsOf(page.id);
    const t = page.draftBody != null ? page.draftTitle ?? page.title : page.title;
    return (
      <>
        <PageContext crumbs={[{ label: page.project.name, href: `/docs/${page.projectId}` }, { label: pageDisplayTitle(page), href: `/docs/${page.projectId}/pages/${page.id}` }, { label: "编辑" }]} />
        <BoardEditor
          crumbs={[
            { label: page.project.name, href: `/docs/${page.projectId}`, project: { name: page.project.name, iconUrl: page.project.iconUrl } },
            ...ancestorsB.map((a) => ({ label: a.title, href: `/docs/${page.projectId}/pages/${a.id}`, icon: "file" as const })),
            { label: pageDisplayTitle(page) },
          ]}
          spaceId={page.projectId}
          page={{ id: page.id, title: page.version === 0 && t === "无标题画布" ? "" : t, scene: page.draftBody ?? page.body, version: page.version, parentId: page.parentId }}
        />
      </>
    );
  }

  const source = page.draftBody ?? page.body;
  const linkRefs = page.links.map((l) => (l.requirementId ? { kind: "req" as const, id: l.requirementId } : { kind: "bug" as const, id: l.bugId! }));
  const refInfo = await loadRefInfo([...extractRefs(source), ...linkRefs], session);
  // 引用刷新为最新标题和状态；标题锚点 id 会在保存时被清掉
  const { html } = renderDocHtml(source, refInfo);
  const ancestors = await ancestorsOf(page.id);
  const title = page.draftBody != null ? page.draftTitle ?? page.title : page.title;

  return (
    <>
      <PageContext
        crumbs={[
          { label: page.project.name, href: `/docs/${page.projectId}` },
          { label: pageDisplayTitle(page), href: `/docs/${page.projectId}/pages/${page.id}` },
          { label: "编辑" },
        ]}
      />
      <DocEditor
        crumbs={[
          { label: page.project.name, href: `/docs/${page.projectId}`, project: { name: page.project.name, iconUrl: page.project.iconUrl } },
          ...ancestors.map((a) => ({ label: a.title, href: `/docs/${page.projectId}/pages/${a.id}`, icon: "file" as const })),
          { label: pageDisplayTitle(page) },
        ]}
        spaceId={page.projectId}
        statusTags={DOC_STATUS_TAGS}
        page={{
          id: page.id,
          title: page.version === 0 && title === "无标题页面" ? "" : title,
          html: html.replace(/ id="h-\d+"/g, ""),
          statusTag: page.statusTag,
          version: page.version,
          draftSavedAt: page.draftBody != null && page.version > 0 ? page.draftUpdatedAt?.toISOString() ?? null : null,
          parentId: page.parentId,
        }}
        initialLinks={page.links.flatMap((l) => {
          const kind = l.requirementId ? ("req" as const) : ("bug" as const);
          const id = (l.requirementId || l.bugId)!;
          const info = refInfo.get(`${kind}:${id}`);
          return info ? [{ linkId: l.id, kind, id, code: info.code, title: info.title, status: info.status }] : [];
        })}
      />
    </>
  );
}
