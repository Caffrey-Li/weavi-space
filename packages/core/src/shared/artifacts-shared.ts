/**
 * 需求资料（T42）的纯函数：前后端共用（客户端也引用，不要引 prisma）。
 */

export const ARTIFACT_KINDS = ["ui", "prototype", "doc", "testcases", "report", "other"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const ARTIFACT_LABEL: Record<ArtifactKind, string> = {
  ui: "UI 设计",
  prototype: "原型",
  doc: "需求文档",
  testcases: "测试用例",
  report: "测试报告",
  other: "其他",
};

/** 齐全度：文档、用例、报告是每条需求都该有的；UI 和原型不是每条都需要（纯后端需求没有 UI） */
export const COMPLETENESS_KINDS = ["ui", "prototype", "doc", "testcases", "report"] as const;
export type CompletenessKind = (typeof COMPLETENESS_KINDS)[number];
export const REQUIRED_KINDS: readonly CompletenessKind[] = ["doc", "testcases", "report"];

export const ARTIFACT_SOURCES = ["link", "file", "doc"] as const;
export type ArtifactSource = (typeof ARTIFACT_SOURCES)[number];

export const ARTIFACT_MAX_PER_REQUIREMENT = 50;

export function isArtifactKind(v: unknown): v is ArtifactKind {
  return typeof v === "string" && (ARTIFACT_KINDS as readonly string[]).includes(v);
}

/** 只接受 http(s) 地址，去掉首尾空白；不合法返回 null */
export function cleanArtifactUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 2000) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const HOSTS: [RegExp, string][] = [
  [/(^|\.)figma\.com$/i, "Figma"],
  [/(^|\.)mastergo\.com$/i, "MasterGo"],
  [/(^|\.)js\.design$/i, "即时设计"],
  [/(^|\.)modao\.cc$/i, "墨刀"],
  [/(^|\.)lanhuapp\.com$/i, "蓝湖"],
  [/(^|\.)axure(cloud)?\.com$/i, "Axure"],
  [/(^|\.)feishu\.cn$|(^|\.)larksuite\.com$/i, "飞书"],
];

/** 链接来自哪个工具（显示用） */
export function linkSite(url: string): string {
  try {
    const host = new URL(url).hostname;
    for (const [re, name] of HOSTS) if (re.test(host)) return name;
    return host.replace(/^www\./, "");
  } catch {
    return "链接";
  }
}

/**
 * Figma 文件 / 原型地址可以内嵌预览：返回官方 embed 地址，否则 null。
 * 11-23：旧的 www.figma.com/embed?url= 现在会直接跳到完整编辑器，而编辑器不允许被嵌入，内嵌区域一片空白；
 * 改用 Embed Kit 2.0 的 embed.figma.com/<类型>/<文件>/...?embed-host=，保留 node-id 等参数。
 */
export function figmaEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)figma\.com$/i.test(u.hostname) || u.protocol !== "https:") return null;
    if (u.hostname === "embed.figma.com") return u.toString();
    const m = u.pathname.match(/^\/(design|file|proto|board|slides|deck)\/(.+)$/);
    if (!m) return null;
    const type = m[1] === "file" ? "design" : m[1];
    const q = new URLSearchParams(u.search);
    q.delete("t");
    q.set("embed-host", "weavi");
    return `https://embed.figma.com/${type}/${m[2]}?${q.toString()}`;
  } catch {
    return null;
  }
}

/** 从地址猜一个标题：Figma 取文件名段，其他取最后一段 / 域名 */
export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = decodeURIComponent(parts[parts.length - 1] || "");
    const name = /(^|\.)figma\.com$/i.test(u.hostname) && parts.length >= 3 ? decodeURIComponent(parts[2]) : last;
    return (name.replace(/[-_]+/g, " ").trim() || u.hostname).slice(0, 120);
  } catch {
    return "";
  }
}

/** 上传的文件能不能当网页打开（只在沙箱里） */
export function looksLikeHtml(b: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.slice(0, 2048)).replace(/^﻿/, "").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<!--") || /^<(head|body|meta|div|style|script)\b/.test(head);
}

export type ArtifactItem = {
  /** 手动挂的是资料 id；自动带出的以 auto: 开头 */
  id: string;
  kind: ArtifactKind;
  source: ArtifactSource | "auto";
  title: string;
  /** 来源说明：Figma · 陈静 · 11-04 */
  meta: string;
  note: string | null;
  /** 点标题去哪 */
  href: string;
  /** 线上地址原文（只有 source = link 才有；href 可能已换成系统预览页） */
  url?: string;
  /** 能在系统里预览（UI / 原型 / 图片） */
  preview: boolean;
  badge: { label: string; tone: "success" | "warning" | "danger" | "neutral" } | null;
  /** 来自父需求 */
  inherited: boolean;
  /** 能删（手动挂的、不是继承来的） */
  removable: boolean;
};

export type Completeness = Record<CompletenessKind, boolean>;

export function completenessOf(items: { kind: ArtifactKind }[]): Completeness {
  const has = (k: ArtifactKind) => items.some((i) => i.kind === k);
  return { ui: has("ui"), prototype: has("prototype"), doc: has("doc"), testcases: has("testcases"), report: has("report") };
}

export function missingRequired(c: Completeness): CompletenessKind[] {
  return REQUIRED_KINDS.filter((k) => !c[k]);
}

export function sortArtifacts<T extends { kind: ArtifactKind }>(items: T[]): T[] {
  const order = (k: ArtifactKind) => ARTIFACT_KINDS.indexOf(k);
  return items.map((x, i) => ({ x, i })).sort((a, b) => order(a.x.kind) - order(b.x.kind) || a.i - b.i).map((p) => p.x);
}
