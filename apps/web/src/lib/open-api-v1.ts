/** 开放接口 v1 的处理逻辑：路由（令牌）和系统内 Agent（登录用户）共用 */
import { NextResponse } from "next/server";
import { authenticateApiToken, authorizeApiToken, type ApiTokenPrincipal } from "@pm-collab/core/api-tokens";
import type { ApiScope } from "@pm-collab/core/api-tokens/scopes";
import { list, detail, type Resource } from "@pm-collab/core/open-api/read";
import * as requirements from "@pm-collab/core/requirements/root";
import * as requirementId from "@pm-collab/core/requirements/id";
import * as requirementStatus from "@pm-collab/core/requirements/id-status";
import * as requirementComments from "@pm-collab/core/requirements/id-comments";
import * as bugs from "@pm-collab/core/bugs/index";
import * as bugId from "@pm-collab/core/bugs/id";
import * as bugStatus from "@pm-collab/core/bugs/id-status";
import * as bugComments from "@pm-collab/core/bugs/id-comments";
import * as productId from "@pm-collab/core/products/id";
import { loadRefInfo } from "@pm-collab/core/docs/docs-query";
import { prisma } from "@/lib/prisma";
import { inProjectsWhere, productWhere, projectWhere, requirementWhere, userWhere, type Access } from "@/lib/access";
import { readAssignees } from "@/lib/requirement-write";
import { attachmentIds, canReadAttachment } from "@/lib/attachments";
import { extractRefs, renderDocHtml } from "@/lib/doc-html";
import type { SessionUser } from "@/lib/auth";
import { v1ReadExtra } from "@/lib/open-api-v1-extra";

const readScopes: Record<string, ApiScope> = { projects: "projects.read", requirements: "requirements.read", bugs: "bugs.read", releases: "releases.read", products: "products.read", spaces: "docs.read", pages: "docs.read" };
export const error = (status: number, message: string, code = ({ 400: "invalid_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "revision_conflict", 405: "method_not_allowed", 429: "rate_limited" } as Record<number, string>)[status] || "internal_error") => NextResponse.json({ error: { code, message } }, { status });
const success = (data: unknown, meta?: { page: number; pageSize: number; total: number }) => NextResponse.json(meta ? { data, meta } : { data });
const missing = () => error(404, "资源不存在");
function pagination(url: URL) {
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || (!Number.isSafeInteger((page - 1) * pageSize) || (page - 1) * pageSize > 2147483647)) return null;
  return { page, pageSize };
}
export async function identity(req: Request) {
  const auth = await authenticateApiToken(req);
  if (!auth.ok) return { ok: false, response: error(auth.status, auth.status === 429 ? "请求过于频繁" : "令牌无效或已失效") } as const;
  return { ok: true, principal: auth.principal } as const;
}
function serviceResponse(result: { body: unknown; init?: { status: number } }) {
  const status = result.init?.status ?? 200;
  const body = result.body as { error?: unknown; code?: unknown };
  if (status >= 400) return error(status, typeof body?.error === "string" ? body.error : "请求失败", typeof body?.code === "string" ? body.code : undefined);
  return success(result.body);
}

/** 现有服务的关联字段也必须留在调用者的数据范围内。 */
async function refsVisible(body: Record<string, unknown>, kind: "requirements" | "bugs", access: Access, user: SessionUser) {
  if (body.projectId && !(await prisma.project.findFirst({ where: { id: String(body.projectId), AND: [projectWhere(access)] }, select: { id: true } }))) return false;
  const parent = kind === "requirements" ? body.parentId : body.requirementId;
  if (parent && !(await prisma.requirement.findFirst({ where: { id: String(parent), AND: [requirementWhere(access)] }, select: { id: true } }))) return false;
  if (body.releaseId && !(await prisma.release.findFirst({ where: { id: String(body.releaseId), AND: [inProjectsWhere(access)] }, select: { id: true } }))) return false;
  const productId = kind === "requirements" ? body.productRefId : body.productId;
  if (productId && !(await prisma.product.findFirst({ where: { id: String(productId), AND: [productWhere(access)] }, select: { id: true } }))) return false;
  if (body.productNodeId && !(await prisma.productNode.findFirst({ where: { id: String(body.productNodeId), product: { is: productWhere(access) } }, select: { id: true } }))) return false;
  const assigned = kind === "requirements" ? Object.values(readAssignees(body) ?? {}) : [body.assigneeId, body.frontendId, body.backendId];
  const ids = [...new Set(assigned.filter((v): v is string => typeof v === "string" && !!v))];
  if (ids.length && await prisma.user.count({ where: { id: { in: ids }, AND: [userWhere(access)] } }) !== ids.length) return false;
  const refs = attachmentIds(typeof body.descriptionHtml === "string" ? body.descriptionHtml : typeof body.body === "string" ? body.body : null);
  if (refs.length) {
    const attachments = await prisma.attachment.findMany({ where: { id: { in: refs } }, select: { id: true, ownerType: true, ownerId: true, uploaderId: true } });
    if (attachments.length !== refs.length) return false;
    for (const att of attachments) {
      if ((!att.ownerId && att.uploaderId !== user.id) || !(await canReadAttachment(user, att))) return false;
    }
  }
  return true;
}

/** 读：principal 是令牌身份；系统内 Agent 用登录用户自己构造（没有 apiTokenScopes 时按账号本身的权限） */
export async function v1Read(principal: ApiTokenPrincipal, path: string[], url: URL) {
  const auth = { principal };
  if (path.length === 1 && path[0] === "me") {
    const { id, email, name, globalRole, avatarUrl } = auth.principal.user;
    return success({ id, email, name, globalRole, avatarUrl });
  }
  const extra = await v1ReadExtra(auth.principal, path, url);
  if (extra) return extra;
  const docs = path[0] === "docs";
  const resource = (docs ? path[1] : path[0]) as Resource | "pages";
  const scope = readScopes[resource];
  const id = docs ? path[2] : path[1];
  const isList = !id && resource !== "pages" && (!docs || resource === "spaces");
  if (!scope || (docs && !["spaces", "pages"].includes(resource)) || (!docs && !["projects", "requirements", "bugs", "releases", "products"].includes(resource)) || (docs && path.length !== (isList ? 2 : 3)) || (!docs && path.length !== (isList ? 1 : 2)) || (docs && resource === "spaces" && !isList)) return missing();
  const authorized = await authorizeApiToken(auth.principal, scope);
  if (!authorized) return error(403, "令牌权限不足");
  if (!isList) {
    const item = await detail(resource, id, authorized.access);
    if (!item) return missing();
    if (resource === "bugs") {
      const result = await bugId.GET(authorized.user, { id });
      if (result.init?.status) return serviceResponse(result);
      return success((result.body as { bug: unknown }).bug);
    }
    if (resource === "products") {
      const result = await productId.GET(authorized.user, { id });
      if (result.init?.status) return serviceResponse(result);
      const product = (result.body as { product: { projectIds: string[]; counts: { projects: number; requirements: number; nodes: number } } }).product;
      const [projects, requirements] = await Promise.all([
        prisma.project.findMany({ where: { id: { in: product.projectIds }, AND: [projectWhere(authorized.access)] }, select: { id: true } }),
        prisma.requirement.count({ where: { productId: id, archivedAt: null, AND: [requirementWhere(authorized.access)] } }),
      ]);
      product.projectIds = projects.map((project) => project.id);
      product.counts = { ...product.counts, projects: projects.length, requirements };
      return success(product);
    }
    if (resource === "pages") {
      // 正文里的需求 / Bug 引用存的是插入时的标题快照；与网页版一样按当前令牌用户重新渲染，看不到的显示为已删除。
      const page = item as { body: string };
      const refs = extractRefs(page.body);
      if (refs.length) page.body = renderDocHtml(page.body, await loadRefInfo(refs, authorized.user)).html;
    }
    return success(item);
  }
  const paging = pagination(url);
  if (!paging) return error(400, "分页参数无效，pageSize 最大为 100");
  const { items, total } = await list(resource as Resource, authorized.access, { ...paging, projectId: url.searchParams.get("projectId"), status: url.searchParams.get("status") });
  return success(items, { ...paging, total });
}

/** 写：body 已解析好的 JSON 对象 */
export async function v1Write(principal: ApiTokenPrincipal, method: "POST" | "PATCH", path: string[], raw: unknown) {
  const auth = { principal };
  const kind = path[0];
  const id = path[1];
  const action = path[2];
  if (!["requirements", "bugs"].includes(kind) || path.length > 3 || (method === "POST" && !((path.length === 1) || (path.length === 3 && action === "comments"))) || (method === "PATCH" && !((path.length === 2) || (path.length === 3 && action === "status")))) return missing();
  const scope: ApiScope = kind === "bugs" ? "bugs.edit" : method === "POST" && !id ? "requirements.create" : action === "status" ? "board.move" : "requirements.edit";
  const authorized = await authorizeApiToken(auth.principal, scope);
  if (!authorized) return error(403, "令牌权限不足或无权操作");
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const guard = (refs: Record<string, unknown>) => refsVisible(refs, kind as "requirements" | "bugs", authorized.access, authorized.user);
  const params = { id };
  if (kind === "requirements") {
    if (method === "POST" && !id) return serviceResponse(await requirements.POST(authorized.user, body, guard));
    if (action === "comments") return serviceResponse(await requirementComments.POST(authorized.user, params, body, guard));
    if (action === "status") return serviceResponse(await requirementStatus.PATCH(authorized.user, params, body));
    return serviceResponse(await requirementId.PATCH(authorized.user, params, body, guard));
  }
  if (method === "POST" && !id) return serviceResponse(await bugs.POST(authorized.user, body, guard));
  if (action === "comments") return serviceResponse(await bugComments.POST(authorized.user, params, body, guard));
  if (action === "status") return serviceResponse(await bugStatus.PATCH(authorized.user, params, body));
  return serviceResponse(await bugId.PATCH(authorized.user, params, body, guard));
}
