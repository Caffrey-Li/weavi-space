import type { NextResponse } from "next/server";
import { error, identity, v1Read, v1Write } from "@/lib/open-api-v1";
import { logApiAccess, v1Action } from "@pm-collab/core/api-tokens/access-log";
import type { ApiTokenPrincipal } from "@pm-collab/core/api-tokens";

type RouteContext = { params: Promise<{ path: string[] }> };

/** T34：每次请求记一条调用记录（只记接口和结果码） */
async function logged(principal: ApiTokenPrincipal, method: string, path: string[], res: NextResponse) {
  await logApiAccess({ enterpriseId: principal.enterpriseId, userId: principal.user.id, tokenId: principal.tokenId, channel: "v1", action: v1Action(method, path), status: res.status });
  return res;
}
async function read(req: Request, ctx: RouteContext) {
  const auth = await identity(req);
  if (!auth.ok) return auth.response;
  const path = (await ctx.params).path;
  return logged(auth.principal, "GET", path, await v1Read(auth.principal, path, new URL(req.url)));
}
async function write(req: Request, ctx: RouteContext, method: "POST" | "PATCH") {
  const auth = await identity(req);
  if (!auth.ok) return auth.response;
  const path = (await ctx.params).path;
  return logged(auth.principal, method, path, await v1Write(auth.principal, method, path, await req.json().catch(() => ({}))));
}
async function respond(action: () => Promise<NextResponse>) {
  try { return await action(); }
  catch { return error(500, "服务器处理失败，请稍后重试"); }
}
export const GET = (req: Request, ctx: RouteContext) => respond(() => read(req, ctx));
export const POST = (req: Request, ctx: RouteContext) => respond(() => write(req, ctx, "POST"));
export const PATCH = (req: Request, ctx: RouteContext) => respond(() => write(req, ctx, "PATCH"));

export const DELETE = () => error(405, "本接口不支持此操作");
export const PUT = () => error(405, "本接口不支持此操作");
