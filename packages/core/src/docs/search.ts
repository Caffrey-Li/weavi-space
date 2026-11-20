import { Prisma } from "@prisma/client";
import { prisma } from "@pm-collab/db/prisma";
import { getAccess } from "../access";

/**
 * T36 知识库检索：按关键词搜文档标题和正文（只搜已发布内容，不含草稿、回收站、已归档）。
 * 用 PostgreSQL 的 ILIKE 做子串匹配（中文不需要分词，任何连续的字都能搜到）；多个词用空格分开，必须都出现。
 * 正文先去掉 HTML 标签再匹配；画布、测试用例页的正文是 JSON，只按标题和其中的文字匹配，摘要用标题。
 * 数据范围和网页一致：只搜本人能看到的空间。排序：标题命中优先，其次正文命中次数，再按更新时间。
 */
export type DocHit = { id: string; spaceId: string; spaceName: string; title: string; kind: string; snippet: string; updatedAt: string; score: number };

export function searchTerms(q: string) {
  return Array.from(new Set(q.trim().split(/\s+/).map((t) => t.slice(0, 40)).filter(Boolean))).slice(0, 5);
}

const likeEscape = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);
export const plainText = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

function count(hay: string, needle: string) {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0 && n < 20; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** 摘要：第一个命中词前后各取一段 */
export function snippetOf(text: string, terms: string[], width = 60) {
  const low = text.toLowerCase();
  const at = terms.map((t) => low.indexOf(t.toLowerCase())).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (at === undefined) return text.slice(0, width * 2);
  const start = Math.max(0, at - width);
  return `${start > 0 ? "…" : ""}${text.slice(start, at + width)}${at + width < text.length ? "…" : ""}`;
}

export function scoreOf(title: string, text: string, terms: string[]) {
  const t = title.toLowerCase();
  const b = text.toLowerCase();
  return terms.reduce((s, w) => s + (t.includes(w.toLowerCase()) ? 10 : 0) + Math.min(10, count(b, w.toLowerCase())), 0);
}

export async function searchDocs(user: { id: string; globalRole: string }, opts: { q: string; spaceId?: string | null; limit?: number }) {
  const terms = searchTerms(opts.q || "");
  if (!terms.length) return { terms, hits: [] as DocHit[] };
  const access = await getAccess(user);
  let ids: string[] | null = access.projectIds;
  if (opts.spaceId) {
    if (ids !== null && !ids.includes(opts.spaceId)) return { terms, hits: [] };
    ids = [opts.spaceId];
  }
  if (ids !== null && !ids.length) return { terms, hits: [] };
  const text = Prisma.sql`regexp_replace(p.body, '<[^>]+>', ' ', 'g')`;
  const conds = terms.map((t) => {
    const like = `%${likeEscape(t)}%`;
    return Prisma.sql`(p.title ILIKE ${like} OR ${text} ILIKE ${like})`;
  });
  const scope = ids === null ? Prisma.sql`TRUE` : Prisma.sql`p."projectId" IN (${Prisma.join(ids)})`;
  const rows = await prisma.$queryRaw<{ id: string; projectId: string; title: string; kind: string; body: string; updatedAt: Date }[]>`
    SELECT p.id, p."projectId", p.title, p.kind, p.body, p."updatedAt"
    FROM doc_pages p
    WHERE p."deletedAt" IS NULL AND p."archivedAt" IS NULL AND p.version > 0 AND ${scope} AND ${Prisma.join(conds, " AND ")}
    ORDER BY p."updatedAt" DESC
    LIMIT 300`;
  const spaces = await prisma.project.findMany({ where: { id: { in: Array.from(new Set(rows.map((r) => r.projectId))) } }, select: { id: true, name: true } });
  const name = new Map(spaces.map((s) => [s.id, s.name]));
  const hits = rows
    .map((r) => {
      const body = r.kind === "doc" ? plainText(r.body) : "";
      return {
        id: r.id,
        spaceId: r.projectId,
        spaceName: name.get(r.projectId) || "—",
        title: r.title || "无标题",
        kind: r.kind,
        snippet: body ? snippetOf(body, terms) : r.kind === "board" ? "画布" : "测试用例",
        updatedAt: r.updatedAt.toISOString(),
        score: scoreOf(r.title || "", body, terms),
      };
    })
    .sort((a, b) => b.score - a.score || (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, Math.min(100, Math.max(1, opts.limit || 30)));
  return { terms, hits };
}

const STOP = /怎么样|怎么|什么|如何|哪些|哪个|这个|那个|一下|帮我|我们|你们|请问|是否|的|了|吗|呢|吧|啊/g;

/** AI 对话用：从一句自然语言里取检索片段——按标点、空格、常见虚词切开；长的中文片段再切成相邻两字 */
export function questionGrams(question: string) {
  const segs = question
    .toLowerCase()
    .split(/[\s,，。.!！?？;；:：、()（）"“”'‘’\[\]【】<>《》/\\|]+/)
    .flatMap((s) => s.replace(STOP, " ").split(" "))
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  const out: string[] = [];
  for (const s of segs) {
    if (/^[a-z0-9_\-.]+$/.test(s) || s.length <= 4) out.push(s);
    else for (let i = 0; i + 2 <= s.length; i++) out.push(s.slice(i, i + 2));
  }
  return Array.from(new Set(out)).slice(0, 24);
}

/**
 * AI 对话的知识库参考：任一片段命中即候选，按命中的片段数打分，取最相关的几篇，每篇给开头一段正文。
 * projectId 给了就只在那个项目空间（以及它所属产品的资料空间）里找。
 */
export async function relatedDocs(user: { id: string; globalRole: string }, question: string, opts: { projectId?: string | null; take?: number; chars?: number } = {}) {
  const grams = questionGrams(question);
  if (!grams.length) return [];
  const access = await getAccess(user);
  let ids: string[] | null = access.projectIds;
  if (opts.projectId) {
    const p = await prisma.project.findUnique({ where: { id: opts.projectId }, select: { productId: true } });
    const space = p?.productId ? await prisma.project.findFirst({ where: { productId: p.productId, status: "space" }, select: { id: true } }) : null;
    ids = [opts.projectId, ...(space ? [space.id] : [])].filter((id) => ids === null || ids.includes(id));
  }
  if (ids !== null && !ids.length) return [];
  const text = Prisma.sql`regexp_replace(p.body, '<[^>]+>', ' ', 'g')`;
  const any = grams.map((g) => {
    const like = `%${likeEscape(g)}%`;
    return Prisma.sql`(p.title ILIKE ${like} OR ${text} ILIKE ${like})`;
  });
  const scope = ids === null ? Prisma.sql`TRUE` : Prisma.sql`p."projectId" IN (${Prisma.join(ids)})`;
  const rows = await prisma.$queryRaw<{ id: string; projectId: string; title: string; body: string }[]>`
    SELECT p.id, p."projectId", p.title, p.body
    FROM doc_pages p
    WHERE p."deletedAt" IS NULL AND p."archivedAt" IS NULL AND p.version > 0 AND p.kind = 'doc' AND ${scope} AND (${Prisma.join(any, " OR ")})
    ORDER BY p."updatedAt" DESC
    LIMIT 200`;
  const need = Math.max(1, Math.ceil(grams.length * 0.3));
  return rows
    .map((r) => {
      const body = plainText(r.body);
      const t = r.title.toLowerCase();
      const b = body.toLowerCase();
      const score = grams.reduce((s, g) => s + (t.includes(g) ? 3 : 0) + (b.includes(g) ? 1 : 0), 0);
      const matched = grams.filter((g) => t.includes(g) || b.includes(g)).length;
      return { id: r.id, spaceId: r.projectId, title: r.title, score, matched, excerpt: body.slice(0, opts.chars ?? 1500) };
    })
    .filter((r) => r.matched >= need)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.take ?? 5);
}
