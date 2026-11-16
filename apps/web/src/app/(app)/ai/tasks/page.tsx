import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { getAccess, projectWhere } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { AgentTasksPanel } from "@/components/ai/AgentTasks";

export const dynamic = "force-dynamic";

/** AI · 任务 / 自动化规则（T27 二期，Figma「81」103 / 104） */
export default async function AgentTasksPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === "rules" ? "rules" : "tasks";
  const session = await getSession();
  const access = session ? await getAccess(session) : null;
  const projects = await prisma.project.findMany({ where: { status: "active", ...(access ? projectWhere(access) : { id: "__none__" }) }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "AI 助手", href: "/ai", icon: "sparkles" }, { label: tab === "rules" ? "自动化规则" : "任务" }]} />
      <div className="nv-page-body">
        <Suspense fallback={null}>
          <AgentTasksPanel tab={tab} projects={projects} />
        </Suspense>
      </div>
    </div>
  );
}
