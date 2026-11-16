import type { SessionUser } from "../auth";
import { result, error, type DocAccess } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { canEditDocs, canViewSpace } from "./docs-query";
import { listDocGroups } from "../shared/doc-groups";

async function gate(session: SessionUser, spaceId: string) {
  if (!(await prisma.project.findUnique({ where: { id: spaceId }, select: { id: true } }))) return { error: error("空间不存在", 404) } as const;
  if (!(await canViewSpace(session, spaceId)) || !(await canEditDocs(session, spaceId))) return { error: error("无权编辑该空间的文档", 403) } as const;
  return { session } as const;
}

const cleanName = (v: unknown) => String(v ?? "").trim().slice(0, 30);

/** 新建自定义分组：{ name } */
export async function POST(session: SessionUser, params: { id: string }, input: DocAccess = { url: "", body: null }) {
  const g = await gate(session, params.id);
  if ("error" in g) return g.error;
  const name = cleanName(input.body!.name);
  if (!name) return error("请填写分组名称", 400);
  const groups = await listDocGroups(params.id);
  if (groups.some((x) => x.name === name)) return error("已有同名分组", 400);
  const group = await prisma.docGroup.create({
    data: { projectId: params.id, name, sortOrder: (groups[groups.length - 1]?.sortOrder ?? -1) + 1 },
    select: { id: true, key: true, name: true, sortOrder: true },
  });
  return result({ group });
}

/** 重命名：{ groupId, name }；调整顺序：{ order: [groupId…] } */
export async function PATCH(session: SessionUser, params: { id: string }, input: DocAccess = { url: "", body: null }) {
  const g = await gate(session, params.id);
  if ("error" in g) return g.error;
  const body = input.body!;
  const groups = await listDocGroups(params.id);
  if (Array.isArray(body.order)) {
    const ids = body.order.map(String).filter((id: string) => groups.some((x) => x.id === id));
    await prisma.$transaction(ids.map((id: string, i: number) => prisma.docGroup.update({ where: { id }, data: { sortOrder: i } })));
    return result({ ok: true });
  }
  const group = groups.find((x) => x.id === String(body.groupId || ""));
  if (!group) return error("分组不存在", 404);
  const name = cleanName(body.name);
  if (!name) return error("分组名称不能为空", 400);
  if (groups.some((x) => x.name === name && x.id !== group.id)) return error("已有同名分组", 400);
  await prisma.docGroup.update({ where: { id: group.id }, data: { name } });
  return result({ ok: true });
}

/** 删除自定义分组：?groupId=；分组里的页面移到「业务文档」。默认分组不能删 */
export async function DELETE(session: SessionUser, params: { id: string }, input: DocAccess = { url: "", body: null }) {
  const g = await gate(session, params.id);
  if ("error" in g) return g.error;
  const groupId = new URL(input.url).searchParams.get("groupId") || "";
  const groups = await listDocGroups(params.id);
  const group = groups.find((x) => x.id === groupId);
  if (!group) return error("分组不存在", 404);
  if (group.key) return error("默认分组不能删除，可以改名", 400);
  const moved = await prisma.docPage.updateMany({ where: { projectId: params.id, groupId }, data: { groupId: null } });
  await prisma.docGroup.delete({ where: { id: groupId } });
  return result({ ok: true, moved: moved.count });
}
