import { getSession } from "@/lib/auth";
import { getAccess, projectWhere } from "@/lib/access";
import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { AiChat } from "@/components/ai/AiChat";

export const dynamic = "force-dynamic";

/** AI 助手（Figma 14）：只读问答，可选范围 */
export default async function AiPage() {
  const session = await getSession();
  const access = session ? await getAccess(session) : null;
  const projects = await prisma.project.findMany({ where: { status: "active", ...(access ? projectWhere(access) : { id: "__none__" }) }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  return (
    <Suspense>
      <AiChat projects={projects} />
    </Suspense>
  );
}
