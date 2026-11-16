import type { SessionUser } from "../auth";
import { result } from "./result";
import { mask } from "../shared/secure-config";
import { managedEnterprise } from "../ai/credentials";
import { clearImageConfig, imageConfig, imageUsage, saveImageConfig } from "../ai/image";
import { periodStart } from "../ai/quota";
import { canSeeProject } from "../access";
import { prisma } from "@pm-collab/db/prisma";

const DEFAULTS = { baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seedream-4-0-250828", size: "2048x512" };

/** 能配置哪些范围：系统超管 = 系统级 + 全部企业；企业超管 = 本企业 */
async function scopes(session: SessionUser) {
  const ent = await managedEnterprise(session, null);
  if (session.globalRole === "admin") return [{ id: "", name: "Weavi Space 系统（不属于企业的项目）" }, ...ent.list];
  return ent.list;
}

/** AI 生图配置：Key 永不回传；同时给本月按成员的张数和费用 */
async function view(scope: string, list: { id: string; name: string }[]) {
  const c = await imageConfig(scope);
  return {
    scopes: list,
    scope,
    configured: Boolean(c),
    baseUrl: c?.baseUrl || DEFAULTS.baseUrl,
    model: c?.model || DEFAULTS.model,
    size: c?.size || DEFAULTS.size,
    price: ((c?.priceCents || 0) / 100).toFixed(2),
    keyMasked: mask(c?.apiKey),
    updatedAt: c?.updatedAt || null,
    updatedBy: c?.updatedBy || null,
    usage: await imageUsage(scope, periodStart("month")),
  };
}

export async function GET(session: SessionUser, scopeRaw?: string | null) {
  const list = await scopes(session);
  if (!list.length) return result({ error: "只有系统超管和企业超管可以配置 AI 生图" }, { status: 403 });
  const scope = scopeRaw !== null && scopeRaw !== undefined && list.some((s) => s.id === scopeRaw) ? scopeRaw : list[0].id;
  return result(await view(scope, list));
}

export async function PUT(session: SessionUser, body: Record<string, unknown>) {
  const list = await scopes(session);
  const scope = String(body.scope ?? "");
  if (!list.some((s) => s.id === scope)) return result({ error: "只能配置自己企业的 AI 生图" }, { status: 403 });
  const b = body as { baseUrl?: string; model?: string; apiKey?: string; size?: string; price?: string | number };
  const baseUrl = (b.baseUrl || "").trim().replace(/\/+$/, "").replace(/\/images\/generations$/, "");
  const model = (b.model || "").trim();
  const size = (b.size || "").trim().toLowerCase();
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "https:") throw new Error();
  } catch {
    return result({ error: "服务地址需要是 https:// 开头的完整地址" }, { status: 400 });
  }
  if (!model) return result({ error: "请填写模型名称" }, { status: 400 });
  if (size && !/^\d{3,4}x\d{3,4}$/.test(size)) return result({ error: "背景图尺寸格式应为 2048x512" }, { status: 400 });
  const price = Number(b.price ?? 0);
  if (!Number.isFinite(price) || price < 0 || price > 1000) return result({ error: "单价要在 0～1000 元之间" }, { status: 400 });
  const r = await saveImageConfig(scope, { baseUrl, model, apiKey: b.apiKey?.trim() || undefined, size: size || undefined, priceCents: Math.round(price * 100) }, session);
  if ("error" in r) return result({ error: r.error }, { status: 400 });
  return result(await view(scope, list));
}

export async function DELETE(session: SessionUser, scopeRaw?: string | null) {
  const list = await scopes(session);
  const scope = String(scopeRaw ?? "");
  if (!list.some((s) => s.id === scope)) return result({ error: "只能配置自己企业的 AI 生图" }, { status: 403 });
  await clearImageConfig(scope);
  return result(await view(scope, list));
}

/** 编辑项目时判断「AI 生成」是否可用：只返回是否已配置 */
export async function readyForProject(session: SessionUser, projectId: string) {
  if (!(await canSeeProject(session, projectId))) return result({ configured: false });
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { enterpriseId: true } });
  return result({ configured: Boolean(p && (await imageConfig(p.enterpriseId || ""))) });
}
