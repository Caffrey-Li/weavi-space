import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as enterprises from "@pm-collab/core/nova/enterprises";
import * as admins from "@pm-collab/core/nova/admins";
import { publicOrigin } from "@pm-collab/core/login/links";

type Res = { body: unknown; init?: { status: number } };
type Ctx = { params: Promise<{ id: string }> };
const send = (r: Res) => NextResponse.json(r.body, r.init);
const unauth = () => NextResponse.json({ error: "未登录" }, { status: 401 });
const json = async (req: Request) => (await req.json().catch(() => ({}))) as Record<string, unknown>;

/** Weavi Space 系统后台接口：登录在这里校验，系统超管身份在服务层校验 */
export const enterprisesRoot = {
  GET: async () => { const s = await getSession(); return s ? send(await enterprises.GET(s)) : unauth(); },
  POST: async (req: Request) => { const s = await getSession(); return s ? send(await enterprises.POST(s, await json(req))) : unauth(); },
};
export const enterpriseById = {
  PATCH: async (req: Request, ctx: Ctx) => { const s = await getSession(); return s ? send(await enterprises.PATCH(s, await ctx.params, await json(req))) : unauth(); },
  PUT: async (req: Request, ctx: Ctx) => { const s = await getSession(); return s ? send(await enterprises.PUT(s, await ctx.params, await json(req), publicOrigin(req.url, req.headers))) : unauth(); },
};
export const enterpriseCandidates = {
  GET: async (_req: Request, ctx: Ctx) => { const s = await getSession(); return s ? send(await enterprises.candidates(s, await ctx.params)) : unauth(); },
};
export const adminsRoot = {
  GET: async () => { const s = await getSession(); return s ? send(await admins.GET(s)) : unauth(); },
  POST: async (req: Request) => { const s = await getSession(); return s ? send(await admins.POST(s, await json(req))) : unauth(); },
  DELETE: async (req: Request) => { const s = await getSession(); return s ? send(await admins.DELETE(s, req.url)) : unauth(); },
};
export const adminCandidates = {
  GET: async () => { const s = await getSession(); return s ? send(await admins.candidates(s)) : unauth(); },
};
