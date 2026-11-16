import type { SessionUser } from "../auth";
import type { Prisma } from "@prisma/client";
import { prisma } from "@pm-collab/db/prisma";
import { canSeeProject } from "../access";
import { sanitizeDocHtml } from "../shared/doc-html";
import { result } from "../nova/result";

/** 新建需求 / Bug 的个人模板：只能看到、改自己的；按项目筛选（项目模板 + 通用模板） */
const KEYS: Record<string, string[]> = {
  requirement: ["priority", "assignees", "tags", "productId", "productNodeId", "descriptionHtml"],
  bug: ["severity", "owners", "environment", "device", "productId", "productNodeId", "descriptionHtml"],
};

function clean(kind: string, raw: unknown) {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of KEYS[kind]) {
    if (!(k in src)) continue;
    const v = src[k];
    if (k === "descriptionHtml") out[k] = sanitizeDocHtml(String(v || "")).slice(0, 20000);
    else if (k === "tags") out[k] = Array.isArray(v) ? v.map(String).slice(0, 20) : [];
    else if (k === "assignees" || k === "owners") out[k] = Object.fromEntries(Object.entries((v as Record<string, unknown>) || {}).slice(0, 10).map(([a, b]) => [a, String(b || "")]));
    else out[k] = String(v ?? "").slice(0, 200);
  }
  return out;
}

export async function listTemplates(session: SessionUser, kind: string, projectId: string | null) {
  if (!KEYS[kind]) return result({ error: "类型不对" }, { status: 400 });
  const rows = await prisma.formTemplate.findMany({
    where: { userId: session.id, kind, ...(projectId ? { OR: [{ projectId }, { projectId: null }] } : {}) },
    orderBy: [{ projectId: "desc" }, { updatedAt: "desc" }],
    take: 50,
  });
  return result({ templates: rows.map((r) => ({ id: r.id, name: r.name, projectId: r.projectId, data: r.data, updatedAt: r.updatedAt.toISOString() })) });
}

export async function createTemplate(session: SessionUser, body: Record<string, unknown>) {
  const kind = String(body.kind || "");
  if (!KEYS[kind]) return result({ error: "类型不对" }, { status: 400 });
  const name = String(body.name || "").trim().slice(0, 40);
  if (!name) return result({ error: "请填写模板名称" }, { status: 400 });
  const projectId = body.projectId ? String(body.projectId) : null;
  if (projectId && !(await canSeeProject(session, projectId))) return result({ error: "项目不存在" }, { status: 404 });
  if ((await prisma.formTemplate.count({ where: { userId: session.id } })) >= 100) return result({ error: "模板最多 100 个" }, { status: 400 });
  const t = await prisma.formTemplate.create({ data: { userId: session.id, kind, name, projectId, data: clean(kind, body.data) as Prisma.InputJsonObject } });
  return result({ id: t.id });
}

export async function updateTemplate(session: SessionUser, id: string, body: Record<string, unknown>) {
  const t = await prisma.formTemplate.findFirst({ where: { id, userId: session.id } });
  if (!t) return result({ error: "模板不存在" }, { status: 404 });
  const data: Prisma.FormTemplateUpdateInput = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 40);
  if (body.data !== undefined) data.data = clean(t.kind, body.data) as Prisma.InputJsonObject;
  await prisma.formTemplate.update({ where: { id }, data });
  return result({ ok: true });
}

export async function deleteTemplate(session: SessionUser, id: string) {
  const r = await prisma.formTemplate.deleteMany({ where: { id, userId: session.id } });
  return r.count ? result({ ok: true }) : result({ error: "模板不存在" }, { status: 404 });
}
