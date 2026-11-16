import type { SessionUser } from "../auth";
import { result } from "../requirements/result";
import { z } from "zod";
import { prisma } from "@pm-collab/db/prisma";
import { bugWhere, getAccess } from "../access";
import { can } from "../permissions";
import { LifecycleError, runAction } from "../shared/lifecycle";


const MAX_IDS = 200;

const Body = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_IDS) });
export async function POST(session: SessionUser, body: unknown) {
  const parsed = Body.safeParse(body);
  if (!parsed.success) return result({ error: `请选择要删除的 Bug，一次最多 ${MAX_IDS} 个` }, { status: 400 });
  const ids = Array.from(new Set(parsed.data.ids));
  const access = await getAccess(session);
  const visible = new Map(
    (await prisma.bug.findMany({ where: { id: { in: ids }, AND: [bugWhere(access)] }, select: { id: true, projectId: true } })).map((b) => [b.id, b.projectId]),
  );
  const deleted: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of ids) {
    if (!visible.has(id)) {
      skipped.push({ id, reason: "不存在或无权访问" });
      continue;
    }
    if (!(await can(session, "bugs.delete", visible.get(id)))) {
      skipped.push({ id, reason: "没有删除权限" });
      continue;
    }
    try {
      await runAction(session, "bug", id, "delete");
      deleted.push(id);
    } catch (e) {
      if (!(e instanceof LifecycleError)) throw e;
      skipped.push({ id, reason: e.message });
    }
  }
  return result({ deleted, skipped });
}
