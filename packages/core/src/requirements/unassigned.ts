import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { bugWhere, getAccess, projectWhere, requirementWhere } from "../access";
import { reqCodeOf } from "../shared/codes";
import { result } from "./result";

/**
 * 11-22 需求池只在项目里：以前放在公共池（projectId 为空）的需求 / Bug 逐条或批量分到项目。
 * 列表只列本人数据范围内的；移动逐条走需求 / Bug 的修改接口，权限、负责人清理、动态都和手动改项目一样。
 */
export async function listUnassigned(session: SessionUser, take = 200) {
  const access = await getAccess(session);
  const [reqs, bugs, projects] = await Promise.all([
    prisma.requirement.findMany({
      where: { projectId: null, archivedAt: null, deletedAt: null, AND: [requirementWhere(access)] },
      select: { id: true, number: true, title: true, status: true, createdAt: true, productId: true, product: { select: { name: true } }, creator: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.bug.findMany({
      where: { projectId: null, archivedAt: null, deletedAt: null, AND: [bugWhere(access)] },
      select: { id: true, title: true, status: true, createdAt: true, productId: true, product: { select: { name: true } }, creator: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.project.findMany({ where: { status: "active", ...projectWhere(access) }, select: { id: true, name: true, productId: true }, orderBy: { createdAt: "asc" }, take: 200 }),
  ]);
  return {
    requirements: reqs.map((r) => ({ id: r.id, code: reqCodeOf(r), title: r.title, status: r.status, createdAt: r.createdAt.toISOString(), productId: r.productId, product: r.product?.name || null, creator: r.creator.name })),
    bugs: bugs.map((b) => ({ id: b.id, code: "", title: b.title, status: b.status, createdAt: b.createdAt.toISOString(), productId: b.productId, product: b.product?.name || null, creator: b.creator.name })),
    projects,
  };
}

export async function countUnassigned(session: SessionUser) {
  const access = await getAccess(session);
  const [r, b] = await Promise.all([
    prisma.requirement.count({ where: { projectId: null, archivedAt: null, deletedAt: null, AND: [requirementWhere(access)] } }),
    prisma.bug.count({ where: { projectId: null, archivedAt: null, deletedAt: null, AND: [bugWhere(access)] } }),
  ]);
  return r + b;
}

export async function moveUnassigned(session: SessionUser, body: Record<string, unknown>) {
  const kind = body.kind === "bug" ? "bug" : body.kind === "requirement" ? "requirement" : null;
  if (!kind) return result({ error: "类型不对" }, { status: 400 });
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  if (!projectId) return result({ error: "请选择项目" }, { status: 400 });
  const ids = (Array.isArray(body.ids) ? body.ids : []).filter((x): x is string => typeof x === "string").slice(0, 100);
  if (!ids.length) return result({ error: "请至少选一条" }, { status: 400 });
  const { PATCH } = kind === "bug" ? await import("../bugs/id") : await import("./id");
  let moved = 0;
  const errors: string[] = [];
  // Bug 的前后端负责人要是项目成员：不在目标项目里的先清空，和需求换项目时一样
  const members = new Set((await prisma.projectMember.findMany({ where: { projectId }, select: { userId: true } })).map((m) => m.userId));
  const bugOwners = kind === "bug" ? new Map((await prisma.bug.findMany({ where: { id: { in: ids } }, select: { id: true, frontendId: true, backendId: true } })).map((b) => [b.id, b])) : null;
  for (const id of ids) {
    const patch: Record<string, unknown> = { projectId };
    const b = bugOwners?.get(id);
    if (b) {
      patch.frontendId = b.frontendId && members.has(b.frontendId) ? b.frontendId : null;
      patch.backendId = b.backendId && members.has(b.backendId) ? b.backendId : null;
    }
    const r = await PATCH(session, { id }, patch);
    if (r.init?.status && r.init.status >= 400) errors.push(String((r.body as { error?: string }).error || "移动失败"));
    else moved++;
  }
  return result({ moved, errors: Array.from(new Set(errors)).slice(0, 5) });
}
