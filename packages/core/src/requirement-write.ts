import { prisma } from "@pm-collab/db/prisma";
import { REQUIREMENT_ASSIGNEE_SLOTS, normalizePriority } from "./shared/constants";
import { docPlainText, sanitizeDocHtml } from "./shared/doc-html";
import { dayNoon } from "./shared/release-schedule-shared";

export type AssigneeInput = Record<string, string | null | undefined>;

/** 兼容旧请求体（productId / frontendId / backendId）与新请求体（assignees: {product, ...}） */
export function readAssignees(body: Record<string, unknown>): AssigneeInput | null {
  const out: AssigneeInput = {};
  let touched = false;
  const nested = (body.assignees && typeof body.assignees === "object" ? body.assignees : {}) as Record<string, unknown>;
  for (const slot of REQUIREMENT_ASSIGNEE_SLOTS) {
    if (slot.key in nested) {
      out[slot.key] = nested[slot.key] ? String(nested[slot.key]) : null;
      touched = true;
    } else if (slot.formKey in body) {
      out[slot.key] = body[slot.formKey] ? String(body[slot.formKey]) : null;
      touched = true;
    }
  }
  return touched ? out : null;
}

/**
 * 归属项目时，负责人必须是该项目成员。
 * current：编辑时已有的负责人（槽位 → userId）；未改动的历史负责人不重复校验，避免旧数据卡住保存。
 */
export async function validateAssignees(
  projectId: string | null,
  assignees: AssigneeInput | null,
  current?: Map<string, string>,
) {
  if (!assignees) return null;
  const ids = Object.entries(assignees)
    .filter(([role, v]) => Boolean(v) && current?.get(role) !== v)
    .map(([, v]) => v as string);
  if (!ids.length) return null;
  const users = await prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  if (users.length !== new Set(ids).size) return "负责人不存在或已停用";
  if (projectId) {
    const members = await prisma.projectMember.findMany({
      where: { projectId, userId: { in: ids } },
      select: { userId: true },
    });
    const ok = new Set(members.map((m) => m.userId));
    const missing = ids.filter((id) => !ok.has(id));
    if (missing.length) return "负责人需是该项目成员，请先在项目「成员」中按岗位添加";
  }
  return null;
}

/** 按槽位整体替换负责人（未出现在 input 中的槽位不动；null 表示清空） */
export async function applyAssignees(requirementId: string, assignees: AssigneeInput | null) {
  if (!assignees) return;
  for (const [role, userId] of Object.entries(assignees)) {
    if (userId) {
      await prisma.requirementAssignee.upsert({
        where: { requirementId_role: { requirementId, role } },
        create: { requirementId, role, userId },
        update: { userId },
      });
    } else {
      await prisma.requirementAssignee.deleteMany({ where: { requirementId, role } });
    }
  }
}

export function parseDate(raw: unknown): Date | null {
  if (!raw) return null;
  const str = String(raw).trim();
  // 只有日期（日期选择器传来的 YYYY-MM-DD）：存当天 12:00 UTC，避免服务器 / 浏览器时区不同时显示差一天
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return dayNoon(str);
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseUrl(raw: unknown): string | null | "invalid" {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "invalid";
    return s;
  } catch {
    return "invalid";
  }
}

export { normalizePriority };

/** 富文本描述 → { descriptionHtml, summary }：HTML 白名单清洗，summary 存纯文本供列表、搜索、ITR 用 */
export function readDescription(body: Record<string, unknown>): { descriptionHtml: string | null; summary: string | null } | null {
  if ("descriptionHtml" in body) {
    const html = sanitizeDocHtml(String(body.descriptionHtml || ""));
    const text = docPlainText(html);
    const hasImage = html.includes("<img");
    if (!text && !hasImage) return { descriptionHtml: null, summary: null };
    return { descriptionHtml: html, summary: text ? text.slice(0, 2000) : "[图片]" };
  }
  if ("summary" in body) {
    // 旧请求体只传纯文本：清掉富文本，避免两份描述不一致
    return { descriptionHtml: null, summary: body.summary ? String(body.summary) : null };
  }
  return null;
}

/** 标签：字符串数组，去重、去空、每个最长 30 字、最多 20 个 */
export function readTags(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return null;
  const tags = Array.from(new Set(raw.map((t) => String(t).trim().slice(0, 30)).filter(Boolean))).slice(0, 20);
  return tags.length ? JSON.stringify(tags) : null;
}

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** 父需求：不能是自己，也不能是自己的子孙（防止成环）。返回错误文案或 null */
export async function validateParent(selfId: string | null, parentId: string | null) {
  if (!parentId) return null;
  if (parentId === selfId) return "父需求不能是它自己";
  let cur: string | null = parentId;
  for (let depth = 0; cur && depth < 20; depth++) {
    const row: { id: string; parentId: string | null } | null = await prisma.requirement.findUnique({
      where: { id: cur },
      select: { id: true, parentId: true },
    });
    if (!row) return depth === 0 ? "父需求不存在" : null;
    if (selfId && row.parentId === selfId) return "不能把子需求设为父需求";
    cur = row.parentId;
  }
  return null;
}

/** 产品 / 功能模块：只选模块时自动带出产品；两者都传时模块必须属于该产品 */
export async function resolveProductRefs(
  productIdRaw: unknown,
  nodeIdRaw: unknown,
): Promise<{ productId: string | null; productNodeId: string | null } | { error: string }> {
  const productNodeId = nodeIdRaw ? String(nodeIdRaw) : null;
  let productId = productIdRaw ? String(productIdRaw) : null;
  if (productNodeId) {
    const node = await prisma.productNode.findUnique({ where: { id: productNodeId }, select: { productId: true } });
    if (!node) return { error: "功能模块不存在" };
    if (productId && productId !== node.productId) return { error: "功能模块不属于所选产品" };
    productId = node.productId;
  } else if (productId) {
    const p = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!p) return { error: "产品不存在" };
  }
  return { productId, productNodeId };
}
