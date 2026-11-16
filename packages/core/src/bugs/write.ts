import { prisma } from "@pm-collab/db/prisma";
import { BUG_STATUS, SEVERITY_OPTIONS } from "../shared/constants";

export const BUG_STATUS_KEYS = BUG_STATUS.map((s) => s.key as string);

/** 校验 Bug 的项目 / 关联需求 / 负责人是否自洽；返回错误文案或 null */
export async function validateBugRefs(input: {
  projectId: string | null;
  requirementId: string | null;
  assigneeId: string | null;
  severity?: string;
  /** 编辑时原负责人：未改动则不再要求其仍是项目成员 */
  previousAssigneeId?: string | null;
  previousProjectId?: string | null;
}) {
  if (input.severity && !(SEVERITY_OPTIONS as readonly string[]).includes(input.severity)) return "非法严重级别";
  if (!input.projectId) return "请选择所属项目";
  const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
  if (!project) return "项目不存在";
  if (input.requirementId) {
    const r = await prisma.requirement.findUnique({ where: { id: input.requirementId }, select: { projectId: true } });
    if (!r) return "关联需求不存在";
    if (r.projectId !== input.projectId) return "关联需求不属于该项目";
  }
  const assigneeUnchanged =
    input.assigneeId === input.previousAssigneeId && input.projectId === input.previousProjectId;
  if (input.assigneeId && !assigneeUnchanged) {
    const m = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: input.projectId, userId: input.assigneeId } },
      include: { user: { select: { isActive: true } } },
    });
    if (!m || !m.user.isActive) return "负责人需是该项目的在职成员";
  }
  return null;
}

/**
 * Bug 前端 / 后端负责人（11-04）：读请求体里的 frontendId / backendId；旧请求只传 assigneeId 时当作后端负责人。
 * assigneeId（当前处理人）自动 = 后端 ?? 前端。prev 为编辑前的值，未出现在请求体里的字段沿用。
 */
export function readBugOwners(
  body: Record<string, unknown>,
  prev: { frontendId: string | null; backendId: string | null; assigneeId: string | null } = { frontendId: null, backendId: null, assigneeId: null },
) {
  const val = (k: string) => (body[k] ? String(body[k]) : null);
  let frontendId = "frontendId" in body ? val("frontendId") : prev.frontendId;
  let backendId = "backendId" in body ? val("backendId") : prev.backendId;
  if (!("frontendId" in body) && !("backendId" in body) && "assigneeId" in body) {
    backendId = val("assigneeId");
  }
  // 旧数据：只有处理人、没有前后端时，沿用处理人作为后端负责人
  if (!prev.frontendId && !prev.backendId && prev.assigneeId && !("backendId" in body) && !("assigneeId" in body)) backendId = prev.assigneeId;
  if (frontendId === undefined) frontendId = null;
  return { frontendId, backendId, assigneeId: backendId || frontendId };
}

/** 新指派的负责人必须是项目在职成员（没变的不再校验） */
export async function validateBugOwners(projectId: string | null, owners: { frontendId: string | null; backendId: string | null }, prev?: { frontendId: string | null; backendId: string | null; projectId: string | null }) {
  if (!projectId) return null;
  const changed = [owners.frontendId, owners.backendId].filter(
    (id, i): id is string => Boolean(id) && !(prev && prev.projectId === projectId && id === (i === 0 ? prev.frontendId : prev.backendId)),
  );
  if (!changed.length) return null;
  const ms = await prisma.projectMember.findMany({ where: { projectId, userId: { in: changed }, user: { isActive: true } }, select: { userId: true } });
  const ok = new Set(ms.map((m) => m.userId));
  return changed.every((id) => ok.has(id)) ? null : "前端 / 后端负责人需是该项目的在职成员";
}

/** 退回：从「已解决 / 已关闭」改回「待处理 / 进行中 / 重新打开」（11-05，详情页和列表显示被退回次数） */
export { countBugReturns, isBugReturn } from "../shared/bug-return";
