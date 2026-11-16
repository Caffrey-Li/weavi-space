import { notFound } from "next/navigation";
import { format } from "date-fns";
import { findBugForPage, loadBugPageDetails, canViewBugPage } from "@pm-collab/core/bugs/detail-page-query";
import { getSession } from "@/lib/auth";
import { PageContext } from "@/components/layout/PageContext";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { CopyLinkButton } from "@/components/ui/CopyLinkButton";
import { ArchivedBar } from "@/components/lifecycle/ArchivedBar";
import { bugCode } from "@/components/ui/StatusBadge";
import { BugMoreMenu } from "@/components/bugs/BugMoreMenu";
import { BugDetailWorkspace, type BugDetailData, type BugFeedItem } from "@/components/bugs/BugDetailWorkspace";
import { BUG_STATUS } from "@/lib/constants";
import { isBugReturn } from "@/lib/bug-write";
import { textToHtml } from "@/lib/doc-html";

function readStatus(v: string | null) {
  try {
    return String((JSON.parse(v || "{}") as { status?: string }).status || "");
  } catch {
    return "";
  }
}

/** 旧动态里写的是状态 key（「状态 open → resolved」），显示时换成中文 */
function humanize(message: string) {
  return BUG_STATUS.reduce((m, s) => m.replace(new RegExp(`(^|[\\s→])${s.key}(?=$|[\\s→（])`, "g"), `$1${s.label}`), message);
}

/** Bug 详情（11-05）：版式同需求详情（Figma 24），主内容 702 + 属性面板 340，改动即时保存 */
export default async function BugDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const b = await findBugForPage(params.id);
  // 回收站里的按不存在处理；已归档的只读查看，顶部提示可取消归档
  if (!b || b.deletedAt) notFound();
  const session = await getSession();
  if (!session || !(await canViewBugPage(session, b))) notFound();

  const { canEditRaw, canDeleteRaw, logs } = await loadBugPageDetails(session, b);
  const canEdit = canEditRaw && !b.archivedAt;
  const code = bugCode(b.id);
  const listHref = b.project ? `/projects/${b.project.id}/bugs` : "/bugs";
  const lastDesc = [...logs].reverse().find((l) => (l.message || "").includes("描述"));
  // 旧数据只有处理人、没有前后端时，把处理人当作后端负责人显示（同 GET /api/bugs/[id]）
  const backend = b.backend || (!b.frontendId ? b.assignee : null);

  const feed: BugFeedItem[] = [
    ...logs.map((l) => ({
      kind: "log" as const,
      id: l.id,
      at: l.createdAt.toISOString(),
      actor: l.actor ? { name: l.actor.name, avatarUrl: l.actor.avatarUrl } : null,
      message: humanize(l.message || (l.action === "created" ? "提交了 Bug" : l.action)),
      isReturn: l.action === "status_changed" && isBugReturn(readStatus(l.fromValue), readStatus(l.toValue)),
    })),
    ...b.comments.map((c) => ({
      kind: "comment" as const,
      id: c.id,
      at: c.createdAt.toISOString(),
      actor: { id: c.author.id, name: c.author.name, avatarUrl: c.author.avatarUrl },
      html: c.body,
    })),
  ].sort((x, y) => x.at.localeCompare(y.at));

  const data: BugDetailData = {
    id: b.id,
    code,
    title: b.title,
    descriptionHtml: b.descriptionHtml || (b.summary ? textToHtml(b.summary) : ""),
    status: b.status,
    severity: b.severity,
    frontend: b.frontend,
    backend,
    dueAt: b.dueAt ? format(b.dueAt, "yyyy-MM-dd") : "",
    environment: b.environment || "",
    device: b.device || "",
    foundVersion: b.foundVersion || "",
    docUrl: b.docUrl?.trim() || "",
    reopenCount: b.reopenCount,
    requirement: b.requirement
      ? {
          id: b.requirement.id,
          title: b.requirement.title,
          status: b.requirement.status,
          code: b.requirement.project ? `${b.requirement.project.key}-${b.requirement.id.slice(-4).toUpperCase()}` : "",
        }
      : null,
    project: b.project,
    productId: b.productId || "",
    productNodeId: b.productNodeId || "",
    creator: b.creator,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    revision: b.revision,
    lastEdit: lastDesc ? { name: lastDesc.actor?.name || "系统", at: lastDesc.createdAt.toISOString() } : null,
    feed,
  };

  return (
    <div className="nv-page-flush rq-page">
      <PageContext
        scope={b.project ? "project" : "global"}
        projectId={b.projectId}
        crumbs={
          b.project
            ? [{ label: b.project.name, href: `/projects/${b.project.id}` }, { label: "Bug", href: listHref }, { label: code }]
            : [{ label: "Bug", href: "/bugs" }, { label: code }]
        }
      />
      {b.archivedAt ? <ArchivedBar kind="bug" id={b.id} label="Bug" canRestore={canEditRaw} /> : null}
      <WorkHeader
        crumbs={[
          ...(b.project ? [{ label: b.project.name, href: `/projects/${b.project.id}`, project: { name: b.project.name, iconUrl: b.project.iconUrl } }] : []),
          { label: "Bug", href: listHref, icon: "bug" as const },
          { label: code },
        ]}
        actions={
          <>
            <CopyLinkButton />
            <BugMoreMenu id={b.id} code={code} title={b.title} listHref={listHref} canEdit={canEditRaw} canDelete={canDeleteRaw} />
          </>
        }
      />
      <BugDetailWorkspace initial={data} canEdit={canEdit} currentUserId={session.id} isAdmin={session.globalRole === "admin"} />
    </div>
  );
}
