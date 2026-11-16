import { getSession } from "@/lib/auth";
import { getAccess, projectWhere } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { AgentTaskDetail } from "@/components/ai/AgentTaskDetail";

export const dynamic = "force-dynamic";

/** 任务详情：只看自己的任务（接口按 userId 查，别人的返回 404） */
export default async function AgentTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const access = session ? await getAccess(session) : null;
  const projects = await prisma.project.findMany({ where: { status: "active", ...(access ? projectWhere(access) : { id: "__none__" }) }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "AI 助手", href: "/ai", icon: "sparkles" }, { label: "任务", href: "/ai/tasks" }, { label: "详情" }]} />
      <div className="nv-page-body">
        <AgentTaskDetail id={id} projects={projects} />
      </div>
    </div>
  );
}
