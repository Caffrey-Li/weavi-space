import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bugWhere, getAccess, productWhere, projectWhere, requirementWhere } from "@/lib/access";
import { KINDS, KIND_LABEL, LifecycleError, RETENTION_DAYS, runAction, type Action, type Kind } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

type Item = { kind: Kind; id: string; name: string; where: string; by: string; at: string; daysLeft?: number; href?: string };

/** 归档与回收站列表（Figma 44）：只列「自己被归档 / 删除」的一项，随上级进去的下级在说明里计数 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const url = new URL(req.url);
  const trash = url.searchParams.get("tab") === "trash";
  const access = await getAccess(session);
  const scopeProject = projectWhere(access);
  const ids = (rows: { archivedById?: string | null; deletedById?: string | null }[]) => rows.map((r) => (trash ? r.deletedById : r.archivedById)).filter(Boolean) as string[];
  const live = trash ? { deletedVia: "self", deletedAt: { not: null } } : { deletedAt: null };
  const selfArch = { OR: [{ archivedVia: "self" }, { archivedVia: null }] };

  const [products, projects, reqs, bugs, docs] = await Promise.all([
    prisma.product.findMany({
      where: { AND: [productWhere(access), trash ? live : { ...live, status: "archived", ...selfArch }] },
      select: { id: true, name: true, archivedAt: true, archivedById: true, deletedAt: true, deletedById: true, updatedAt: true },
    }),
    prisma.project.findMany({
      where: { AND: [scopeProject, { status: { not: "space" } }, trash ? live : { ...live, status: "archived", ...selfArch }] },
      select: { id: true, name: true, archivedAt: true, archivedById: true, deletedAt: true, deletedById: true, updatedAt: true, product: { select: { name: true } } },
    }),
    prisma.requirement.findMany({
      where: { AND: [requirementWhere(access), trash ? live : { ...live, archivedAt: { not: null }, archivedVia: "self" }] },
      select: { id: true, title: true, archivedAt: true, archivedById: true, deletedAt: true, deletedById: true, project: { select: { name: true } } },
    }),
    prisma.bug.findMany({
      where: { AND: [bugWhere(access), trash ? live : { ...live, archivedAt: { not: null }, archivedVia: "self" }] },
      select: { id: true, title: true, archivedAt: true, archivedById: true, deletedAt: true, deletedById: true, project: { select: { name: true } } },
    }),
    prisma.docPage.findMany({
      // 文档默认还会排除已归档的：这里显式写 archivedAt 条件绕过（删除时顺带归档的也要列出来）
      where: { AND: [access.projectIds ? { projectId: { in: access.projectIds } } : {}, trash ? { ...live, OR: [{ archivedAt: null }, { archivedAt: { not: null } }] } : { ...live, archivedAt: { not: null }, archivedVia: "self" }] },
      select: { id: true, title: true, projectId: true, archivedAt: true, archivedById: true, deletedAt: true, deletedById: true, project: { select: { name: true, status: true } } },
    }),
  ]);

  const userIds = Array.from(new Set([...ids(products), ...ids(projects), ...ids(reqs), ...ids(bugs), ...ids(docs)]));
  const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const who = (r: { archivedById?: string | null; deletedById?: string | null }) => users.get((trash ? r.deletedById : r.archivedById) || "") || "—";
  const when = (r: { archivedAt?: Date | null; deletedAt?: Date | null; updatedAt?: Date }) => (trash ? r.deletedAt : r.archivedAt || r.updatedAt) || new Date();
  const left = (d: Date) => Math.max(0, RETENTION_DAYS - Math.floor((Date.now() - d.getTime()) / 86400000));

  // 随上级一起进去的下级数量
  const count = async (via: string) => {
    const key = trash ? { deletedVia: via, deletedAt: { not: null } } : { archivedVia: via, deletedAt: null };
    const docKey = trash ? { ...key, OR: [{ archivedAt: null }, { archivedAt: { not: null } }] } : { ...key, archivedAt: { not: null } };
    const [r, b, d] = await Promise.all([prisma.requirement.count({ where: key }), prisma.bug.count({ where: key }), prisma.docPage.count({ where: docKey })]);
    const parts = [r ? `${r} 条需求` : "", b ? `${b} 个 Bug` : "", d ? `${d} 篇文档` : ""].filter(Boolean);
    return parts.length ? `连同 ${parts.join("、")}` : "";
  };

  const items: Item[] = [];
  for (const p of products) items.push({ kind: "product", id: p.id, name: p.name, where: await count(`product:${p.id}`), by: who(p), at: when(p).toISOString() });
  for (const p of projects) items.push({ kind: "project", id: p.id, name: p.name, where: [p.product ? `产品「${p.product.name}」` : "", await count(`project:${p.id}`)].filter(Boolean).join(" · "), by: who(p), at: when(p).toISOString() });
  for (const r of reqs) items.push({ kind: "requirement", id: r.id, name: r.title, where: r.project ? `项目「${r.project.name}」` : "未归属项目", by: who(r), at: when(r).toISOString(), href: trash ? undefined : `/requirements/${r.id}` });
  for (const b of bugs) items.push({ kind: "bug", id: b.id, name: b.title, where: b.project ? `项目「${b.project.name}」` : "未归属项目", by: who(b), at: when(b).toISOString() });
  for (const d of docs) items.push({ kind: "doc", id: d.id, name: d.title, where: `空间「${d.project.name}${d.project.status === "space" ? " · 产品资料" : ""}」`, by: who(d), at: when(d).toISOString(), href: trash ? undefined : `/docs/${d.projectId}/pages/${d.id}` });
  if (trash) for (const it of items) it.daysLeft = left(new Date(it.at));
  items.sort((a, b) => b.at.localeCompare(a.at));
  const counts = Object.fromEntries(KINDS.map((k) => [k, items.filter((i) => i.kind === k).length]));
  return NextResponse.json({ items, counts, labels: KIND_LABEL, retentionDays: RETENTION_DAYS, isAdmin: session.globalRole === "admin" });
}

/** POST { kind, id, action: archive | unarchive | delete | restore | purge } */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { kind?: string; id?: string; action?: string };
  if (!KINDS.includes(b.kind as Kind) || !b.id || !["archive", "unarchive", "delete", "restore", "purge"].includes(b.action || "")) {
    return NextResponse.json({ error: "参数不对" }, { status: 400 });
  }
  try {
    const r = await runAction(session, b.kind as Kind, b.id, b.action as Action);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof LifecycleError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[归档 / 回收站]", e);
    return NextResponse.json({ error: "操作失败，请稍后重试" }, { status: 500 });
  }
}
