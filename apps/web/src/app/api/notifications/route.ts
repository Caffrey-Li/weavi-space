import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** 站内通知：GET ?page=&unread=1 → 列表（每页 20）+ 未读数；只看自己的 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const size = Math.min(50, Math.max(5, Number(sp.get("size")) || 20));
  const where = { userId: s.id, ...(sp.get("unread") === "1" ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * size, take: size }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: s.id, readAt: null } }),
  ]);
  return NextResponse.json({ items: items.map((n) => ({ ...n, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() || null })), total, unread, page, size });
}

/** POST { ids?: string[], all?: true } 标为已读 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown; all?: boolean };
  const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : [];
  if (!body.all && !ids.length) return NextResponse.json({ error: "缺少要标记的通知" }, { status: 400 });
  const r = await prisma.notification.updateMany({ where: { userId: s.id, readAt: null, ...(body.all ? {} : { id: { in: ids } }) }, data: { readAt: new Date() } });
  return NextResponse.json({ ok: true, count: r.count });
}
