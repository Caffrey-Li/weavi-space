import type { NextResponse } from "next/server";
import { error, identity, v1Read, v1Write } from "@/lib/open-api-v1";

type RouteContext = { params: Promise<{ path: string[] }> };

async function read(req: Request, ctx: RouteContext) {
  const auth = await identity(req);
  if (!auth.ok) return auth.response;
  return v1Read(auth.principal, (await ctx.params).path, new URL(req.url));
}
async function write(req: Request, ctx: RouteContext, method: "POST" | "PATCH") {
  const auth = await identity(req);
  if (!auth.ok) return auth.response;
  return v1Write(auth.principal, method, (await ctx.params).path, await req.json().catch(() => ({})));
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
