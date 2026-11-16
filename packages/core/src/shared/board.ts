/**
 * 文档「画布」页（DocPage.kind = "board"）：正文存 Excalidraw 场景 JSON。
 * 入库前一律经 sanitizeBoardScene 校验：只认白名单里的图形类型（不允许嵌入外部网页 embeddable / iframe），
 * 链接只留 http(s) 和站内相对地址，图片只收 png / jpeg / gif / webp 的 data URL，整体和单项都限大小。
 * 纯函数，前后端都可以引用。
 */
export const BOARD_KINDS = ["doc", "board"] as const;
export type DocKind = (typeof BOARD_KINDS)[number];
export const BOARD_TEMPLATES = ["blank", "flow", "arch", "swimlane"] as const;
export type BoardTemplate = (typeof BOARD_TEMPLATES)[number];

export const BOARD_MAX_CHARS = 6 * 1024 * 1024; // 整个场景 JSON 上限（含图片）
const MAX_ELEMENTS = 5000;
const MAX_FILE_CHARS = 3 * 1024 * 1024; // 单张图片 data URL 上限
const MAX_FILES = 50;
const ELEMENT_TYPES = new Set(["rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image", "frame"]);
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|transparent|[a-zA-Z]{3,20})$/;

export type BoardScene = { type: "excalidraw"; version: 2; elements: Record<string, unknown>[]; appState: Record<string, unknown>; files: Record<string, Record<string, unknown>>; template?: BoardTemplate };

export const emptyBoard = (template?: BoardTemplate): string =>
  JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {}, ...(template && template !== "blank" ? { template } : {}) });

function safeLink(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const s = v.trim().slice(0, 2000);
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  return null;
}

function cleanValue(v: unknown, depth: number): unknown {
  if (depth > 6) return null;
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") return v.slice(0, 20000);
  if (Array.isArray(v)) return v.slice(0, 20000).map((x) => cleanValue(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 80)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      out[k] = cleanValue(x, depth + 1);
    }
    return out;
  }
  return null;
}

/** 校验并规范化画布场景；不合格返回 null（接口回 400） */
export function sanitizeBoardScene(raw: unknown): string | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > BOARD_MAX_CHARS) return null;
    if (!raw.trim()) return emptyBoard();
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const elements = Array.isArray(d.elements) ? d.elements.slice(0, MAX_ELEMENTS) : [];
  const cleanEls: Record<string, unknown>[] = [];
  for (const e of elements) {
    if (!e || typeof e !== "object") continue;
    const el = cleanValue(e, 0) as Record<string, unknown>;
    if (typeof el.type !== "string" || !ELEMENT_TYPES.has(el.type)) continue;
    if (typeof el.id !== "string" || !el.id || el.id.length > 100) continue;
    el.link = safeLink(el.link);
    delete el.customData;
    for (const c of ["strokeColor", "backgroundColor"]) if (el[c] !== undefined && (typeof el[c] !== "string" || !COLOR.test(el[c] as string))) el[c] = c === "strokeColor" ? "#1e1e1e" : "transparent";
    cleanEls.push(el);
  }
  const files: Record<string, Record<string, unknown>> = {};
  const usedFiles = new Set(cleanEls.filter((e) => e.type === "image" && typeof e.fileId === "string").map((e) => e.fileId as string));
  if (d.files && typeof d.files === "object") {
    for (const [id, f] of Object.entries(d.files as Record<string, unknown>).slice(0, MAX_FILES)) {
      if (!usedFiles.has(id) || !f || typeof f !== "object") continue;
      const file = f as Record<string, unknown>;
      const url = typeof file.dataURL === "string" ? file.dataURL : "";
      if (url.length > MAX_FILE_CHARS || !IMAGE_DATA_URL.test(url)) continue;
      const mime = url.slice(5, url.indexOf(";"));
      files[id] = { id, dataURL: url, mimeType: mime, created: typeof file.created === "number" ? file.created : Date.now() };
    }
  }
  const app = (d.appState && typeof d.appState === "object" ? d.appState : {}) as Record<string, unknown>;
  const appState: Record<string, unknown> = {};
  if (typeof app.viewBackgroundColor === "string" && COLOR.test(app.viewBackgroundColor)) appState.viewBackgroundColor = app.viewBackgroundColor;
  if (typeof app.gridSize === "number" && app.gridSize > 0 && app.gridSize <= 100) appState.gridSize = app.gridSize;
  if (typeof app.gridModeEnabled === "boolean") appState.gridModeEnabled = app.gridModeEnabled;
  const template = BOARD_TEMPLATES.includes(d.template as BoardTemplate) && !cleanEls.length ? (d.template as BoardTemplate) : undefined;
  const out = JSON.stringify({ type: "excalidraw", version: 2, elements: cleanEls, appState, files, ...(template ? { template } : {}) });
  return out.length > BOARD_MAX_CHARS ? null : out;
}

/** 画布的纯文本摘要（列表、搜索用）：取文字元素 */
export function boardText(json: string, max = 200): string {
  try {
    const d = JSON.parse(json) as { elements?: { type?: string; text?: string; isDeleted?: boolean }[] };
    return (d.elements || [])
      .filter((e) => e.type === "text" && !e.isDeleted && e.text)
      .map((e) => e.text!.replace(/\s+/g, " "))
      .join(" · ")
      .slice(0, max);
  } catch {
    return "";
  }
}
