import { reqCodeOf } from "@pm-collab/core/shared/codes";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { bugWhere, getAccess, requirementWhere } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { generateTitleServer } from "@/lib/title-gen";
import { TITLE_MAX } from "@/lib/title-gen-shared";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX = 100;
type Kind = "requirement" | "bug";
type Item = { id: string; projectId: string | null; title: string; html: string; code: string };

async function load(session: NonNullable<Awaited<ReturnType<typeof getSession>>>, kind: Kind, ids: string[]): Promise<Item[]> {
  const access = await getAccess(session);
  if (kind === "bug") {
    const rows = await prisma.bug.findMany({ where: { id: { in: ids }, AND: [bugWhere(access)] }, select: { id: true, projectId: true, title: true, descriptionHtml: true, summary: true } });
    return rows.map((b) => ({ id: b.id, projectId: b.projectId, title: b.title, html: b.descriptionHtml || b.summary || "", code: `BUG-${b.id.slice(-4).toUpperCase()}` }));
  }
  const rows = await prisma.requirement.findMany({
    where: { id: { in: ids }, AND: [requirementWhere(access)] },
    select: { id: true, number: true, projectId: true, title: true, descriptionHtml: true, summary: true, project: { select: { key: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    title: r.title,
    html: r.descriptionHtml || r.summary || "",
    code: reqCodeOf(r),
  }));
}

/** 逐个项目校验编辑权限（同一项目只查一次） */
async function editable(session: NonNullable<Awaited<ReturnType<typeof getSession>>>, kind: Kind, items: Item[]) {
  const feature = kind === "bug" ? "bugs.edit" : "requirements.edit";
  const cache = new Map<string, boolean>();
  const ok = new Set<string>();
  for (const it of items) {
    const key = it.projectId || "";
    if (!cache.has(key)) cache.set(key, await can(session, feature, it.projectId || undefined));
    if (cache.get(key)) ok.add(it.id);
  }
  return ok;
}

/**
 * 批量根据描述生成标题
 * POST { kind, ids }            → 预览：[{ id, code, title, next, reason? }]
 * POST { kind, items: [{id,title}] } → 写入，逐条记动态
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { kind?: string; ids?: unknown; items?: unknown };
  const kind: Kind = body.kind === "bug" ? "bug" : "requirement";

  if (Array.isArray(body.items)) {
    const wanted = (body.items as { id?: unknown; title?: unknown }[])
      .map((x) => ({ id: String(x?.id || ""), title: String(x?.title || "").replace(/\s+/g, " ").trim().slice(0, 200) }))
      .filter((x) => x.id && x.title)
      .slice(0, MAX);
    const items = await load(session, kind, wanted.map((x) => x.id));
    const ok = await editable(session, kind, items);
    let updated = 0;
    const denied: string[] = [];
    for (const w of wanted) {
      const it = items.find((x) => x.id === w.id);
      if (!it) continue;
      if (!ok.has(it.id)) {
        denied.push(it.code);
        continue;
      }
      if (w.title === it.title) continue;
      if (kind === "bug") await prisma.bug.update({ where: { id: it.id }, data: { title: w.title } });
      else await prisma.requirement.update({ where: { id: it.id }, data: { title: w.title } });
      await prisma.activityLog.create({
        data: {
          entityType: kind,
          entityId: it.id,
          action: "updated",
          actorId: session.id,
          fromValue: JSON.stringify({ title: it.title }),
          toValue: JSON.stringify({ title: w.title }),
          message: "根据描述生成标题",
        },
      });
      updated++;
    }
    return NextResponse.json({ updated, denied });
  }

  const ids = Array.isArray(body.ids) ? Array.from(new Set(body.ids.map(String))).slice(0, MAX) : [];
  if (!ids.length) return NextResponse.json({ error: "请先选择要生成标题的条目" }, { status: 400 });
  const items = await load(session, kind, ids);
  const ok = await editable(session, kind, items);
  const out: { id: string; code: string; title: string; next: string; reason?: string }[] = new Array(items.length);
  let source: "ai" | "rules" = "rules";
  // 小并发：配置了大模型时每条一次调用
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      const it = items[i];
      if (!ok.has(it.id)) {
        out[i] = { id: it.id, code: it.code, title: it.title, next: "", reason: "没有编辑权限" };
        continue;
      }
      const g = await generateTitleServer(it.html, kind);
      if (g.source === "ai") source = "ai";
      if (!g.title) out[i] = { id: it.id, code: it.code, title: it.title, next: "", reason: "描述为空，跳过" };
      else if (g.title === it.title) out[i] = { id: it.id, code: it.code, title: it.title, next: g.title, reason: "与现有标题相同" };
      else out[i] = { id: it.id, code: it.code, title: it.title, next: g.title };
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  // 按选中的顺序返回
  const order = new Map(ids.map((id, i) => [id, i]));
  out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return NextResponse.json({ items: out, source, max: TITLE_MAX, truncated: Array.isArray(body.ids) && body.ids.length > MAX });
}
