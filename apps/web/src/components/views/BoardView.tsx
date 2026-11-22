import Link from "next/link";
import { notFound } from "next/navigation";
import { loadBoardContext, loadBoardCards } from "@pm-collab/core/requirements/board-query";
import { getSession } from "@/lib/auth";
import { canMany } from "@/lib/permissions";
import { RequirementBoard } from "@/components/board/RequirementBoard";
import { PageContext } from "@/components/layout/PageContext";
import { flowForProject } from "@pm-collab/core/flow/service";
import { activeIteration } from "@pm-collab/core/requirements/iterations";
import { fmtDate } from "@/lib/utils";

/** 需求看板：projectId 为空 = 全局（全部进行中项目），否则为该项目的看板 */
export async function BoardView({ projectId = "", iteration }: { projectId?: string; iteration?: string }) {
  const session = await getSession();
  const { access, projects, project } = await loadBoardContext(session, projectId);
  if (projectId && !project) notFound();
  const perms = await canMany(session, ["board.move", "requirements.create"] as const, projectId || undefined);

  // T43 Scrum 模式：默认只看进行中的迭代，?iteration=all 看全部
  const flow = projectId && project ? await flowForProject(projectId) : null;
  const active = flow?.mode === "scrum" ? await activeIteration(projectId) : null;
  const only = active && iteration !== "all" ? active : null;
  const cards = await loadBoardCards(access, projects, projectId, only?.id);

  return (
    <div className="nv-list-page board-page">
      <PageContext
        crumbs={
          project
            ? [{ label: "项目", href: "/projects" }, { label: project.name, href: `/projects/${project.id}` }, { label: "项目看板" }]
            : [{ label: "看板" }]
        }
      />
      {active ? (
        <p className="nv-board-iter" role="note">
          {only ? (
            <>
              {active.name} · {fmtDate(active.startAt).slice(5)} → {fmtDate(active.endAt).slice(5)} · 只显示本迭代的需求{" "}
              <Link className="text-link" href={`/projects/${projectId}/board?iteration=all`}>
                看全部
              </Link>
            </>
          ) : (
            <>
              显示全部需求{" "}
              <Link className="text-link" href={`/projects/${projectId}/board`}>
                只看{active.name}
              </Link>
            </>
          )}
          {" · "}
          <Link className="text-link" href={`/projects/${projectId}/iterations`}>
            规划迭代
          </Link>
        </p>
      ) : null}
      {project || projects.length ? (
        <RequirementBoard
          initialCards={cards}
          key={projectId || "all"}
          currentUserId={session?.id}
          canMove={perms["board.move"]}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          projectId={projectId}
          canCreate={perms["requirements.create"]}
          crumbs={
            project
              ? [
                  { label: project.name, href: `/projects/${project.id}`, project: { name: project.name, iconUrl: project.iconUrl } },
                  { label: "需求", icon: "list" },
                ]
              : [{ label: "看板" }]
          }
        />
      ) : (
        <div className="empty-state">
          <p className="empty-title">还没有进行中的项目</p>
          <p>
            先到{" "}
            <Link href="/projects" className="text-link">
              项目
            </Link>{" "}
            创建项目，再在这里按状态推进需求。
          </p>
        </div>
      )}
    </div>
  );
}
