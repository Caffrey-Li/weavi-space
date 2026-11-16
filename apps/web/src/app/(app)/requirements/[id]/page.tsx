import { ArchivedBar } from "@/components/lifecycle/ArchivedBar";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { findRequirementForPage, loadRequirementPageDetails } from "@pm-collab/core/requirements/detail-page-query";
import { getSession } from "@/lib/auth";
import { canSeeRequirement } from "@/lib/access";
import { PageContext } from "@/components/layout/PageContext";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { CopyLinkButton } from "@/components/ui/CopyLinkButton";
import { RequirementMoreMenu } from "@/components/requirements/RequirementMoreMenu";
import { RequirementWorkspace, type ReqFeedItem, type RequirementWorkspaceData } from "@/components/requirements/RequirementWorkspace";
import { SEVERITY_LABELS, normalizePriority } from "@/lib/constants";
import { textToHtml } from "@/lib/doc-html";
import { parseTags } from "@/lib/requirement-write";
import { requirementFlow } from "@pm-collab/core/requirements/flow";
import { RequirementDocs, RequirementFlowBar } from "@/components/requirements/RequirementFlow";

function reqCode(r: { id: string; project?: { key: string } | null }) {
  return r.project ? `${r.project.key}-${r.id.slice(-4).toUpperCase()}` : r.id.slice(-6).toUpperCase();
}

/** 需求详情（Figma 24）：主内容 702 + 属性面板 340，改动即时保存 */
export default async function RequirementDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const r = await findRequirementForPage(params.id);
  // 回收站里的按不存在处理；已归档的只读查看，顶部提示可取消归档
  if (!r || r.deletedAt) notFound();

  const session = await getSession();
  // 数据范围之外的需求按不存在处理
  if (!session || !(await canSeeRequirement(session, { projectId: r.projectId, creatorId: r.creatorId, assigneeIds: r.assignees.map((a) => a.userId) }))) notFound();
  const { perms, logs } = await loadRequirementPageDetails(session, r);
  const flow = await requirementFlow(session, r.id);

  const code = reqCode(r);
  const poolHref = r.project ? `/projects/${r.project.id}/requirements` : "/requirements";
  const lastDesc = [...logs].reverse().find((l) => l.action === "updated" && (l.message || "").includes("描述"));
  const day = (d: Date | null) => (d ? format(d, "yyyy-MM-dd") : "");

  const feed: ReqFeedItem[] = [
    ...logs.map((l) => ({
      kind: "log" as const,
      id: l.id,
      at: l.createdAt.toISOString(),
      actor: l.actor ? { name: l.actor.name, avatarUrl: l.actor.avatarUrl } : null,
      message: l.message || l.action,
    })),
    ...r.comments.map((c) => ({
      kind: "comment" as const,
      id: c.id,
      at: c.createdAt.toISOString(),
      actor: { id: c.author.id, name: c.author.name, avatarUrl: c.author.avatarUrl },
      html: c.body,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const data: RequirementWorkspaceData = {
    id: r.id,
    code,
    title: r.title,
    descriptionHtml: r.descriptionHtml || (r.summary ? textToHtml(r.summary) : ""),
    status: r.status,
    priority: normalizePriority(r.priority),
    assignees: Object.fromEntries(r.assignees.map((a) => [a.role, a.userId])),
    startAt: day(r.startAt),
    plannedEndAt: day(r.plannedEndAt),
    tags: parseTags(r.tags),
    parent: r.parent ? { id: r.parent.id, title: r.parent.title, code: reqCode(r.parent) } : null,
    productId: r.productId || "",
    productNodeId: r.productNodeId || "",
    projectId: r.projectId || "",
    releaseId: "",
    releases: r.releaseItems.map((it) => ({ id: it.release.id, version: it.release.version })),
    docUrl: r.docUrl?.trim() || "",
    proposerId: r.proposerId || "",
    proposer: r.proposer ? { name: r.proposer.name, avatarUrl: r.proposer.avatarUrl } : null,
    creator: { name: r.creator.name, avatarUrl: r.creator.avatarUrl },
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    revision: r.revision,
    lastEdit: lastDesc ? { name: lastDesc.actor?.name || "系统", at: lastDesc.createdAt.toISOString() } : null,
    children: r.children.map((c) => ({
      id: c.id,
      code: reqCode(c),
      title: c.title,
      status: c.status,
      priority: normalizePriority(c.priority),
      owner: c.assignees[0] ? { name: c.assignees[0].user.name, avatarUrl: c.assignees[0].user.avatarUrl } : null,
      plannedEndAt: day(c.plannedEndAt),
    })),
    bugs: r.bugs.map((b) => ({
      id: b.id,
      title: b.title,
      status: b.status,
      severity: SEVERITY_LABELS[b.severity] || b.severity,
      assignee: b.assignee?.name || null,
      href: `/bugs/${b.id}`,
    })),
    feed,
  };

  return (
    <div className="nv-page-flush rq-page">
      <PageContext
        scope={r.project ? "project" : "global"}
        projectId={r.projectId}
        crumbs={
          r.project
            ? [
                { label: r.project.name, href: `/projects/${r.project.id}` },
                { label: "需求池", href: poolHref },
                { label: code },
              ]
            : [{ label: "需求池", href: "/requirements" }, { label: code }]
        }
      />
      {r.archivedAt ? <ArchivedBar kind="requirement" id={r.id} label="需求" canRestore={perms["requirements.edit"]} /> : null}
      <WorkHeader
        crumbs={[
          ...(r.project ? [{ label: r.project.name, href: `/projects/${r.project.id}`, project: { name: r.project.name, iconUrl: r.project.iconUrl } }] : []),
          { label: "需求池", href: poolHref, icon: "inbox" as const },
          { label: code },
        ]}
        actions={
          <>
            <CopyLinkButton />
            <RequirementMoreMenu
              id={r.id}
              code={code}
              title={r.title}
              projectId={r.projectId}
              poolHref={poolHref}
              canEdit={perms["requirements.edit"]}
              canCreate={perms["requirements.create"]}
            />
          </>
        }
      />
      <RequirementWorkspace
        mode="edit"
        initial={data}
        perms={{ edit: perms["requirements.edit"], move: perms["board.move"], bug: perms["bugs.edit"] }}
        returnHref={poolHref}
        currentUserId={session?.id}
        isAdmin={session?.globalRole === "admin"}
        flowSlot={flow ? <RequirementFlowBar id={r.id} flow={flow} /> : null}
        docsSlot={flow ? <RequirementDocs id={r.id} flow={flow} canEdit={perms["requirements.edit"]} /> : null}
      />
    </div>
  );
}
