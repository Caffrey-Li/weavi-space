import { feishuSettings } from "./feishu-auth";

/**
 * 飞书开放平台（应用身份）：tenant_access_token、电子表格、多维表格、知识库链接解析、发消息。
 * 凭据沿用「系统设置 › 飞书登录」里加密保存的企业自建应用；令牌只在内存缓存，不落盘。
 */
const BASE = "https://open.feishu.cn/open-apis";

export class FeishuApiError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
  }
}

let tokenCache: { appId: string; token: string; exp: number } | null = null;

async function tenantToken(force = false): Promise<string> {
  const cfg = await feishuSettings();
  if (!cfg) throw new FeishuApiError("还没有配置飞书应用：请管理员先在「系统设置 › 飞书登录」填写 App ID 和 App Secret");
  if (!force && tokenCache && tokenCache.appId === cfg.appId && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (data.code !== 0 || !data.tenant_access_token) throw new FeishuApiError(`获取飞书应用令牌失败：${data.msg || res.status}`, data.code);
  tokenCache = { appId: cfg.appId, token: data.tenant_access_token, exp: Date.now() + (data.expire || 7200) * 1000 };
  return tokenCache.token;
}

/** 把飞书错误码翻译成能照着处理的话 */
function explain(code: number | undefined, msg: string | undefined, path: string): string {
  const raw = `${msg || "未知错误"}（${code ?? "?"}）`;
  if ((code === 99991672 || code === 99991679) && path.includes("/drive/")) return `下载表格里的图片需要应用开通「drive:drive:readonly」或「docs:document.media:download」权限并发布新版本。${raw}`;
  if (code === 99991672 || code === 99991679) return `飞书应用缺少接口权限：请在开发者后台「权限管理」开通相应权限并发布新版本。${raw}`;
  if (code === 131006) {
    return `应用没有这个知识库页面的访问权限：请在飞书里打开这份表格，点右上角「···」›「更多」›「添加文档应用」，搜索本应用并给「可编辑」权限；也可以由知识库管理员把本应用加为知识空间成员。${raw}`;
  }
  if (code === 91403 || code === 1254302 || code === 1310213 || code === 1254040) {
    return `应用没有这份表格的访问权限：请在飞书里打开这份表格，点右上角「···」›「更多」›「添加文档应用」，搜索本应用并给「可编辑」权限。${raw}`;
  }
  if (code === 230002) return `机器人不在会话中或不能私信该用户：请确认应用已开启机器人能力并已发布。${raw}`;
  if (code === 1254005 || code === 1254004 || code === 1310214) return `表格或数据表不存在，请检查链接。${raw}`;
  if (path.includes("/im/")) return `飞书消息发送失败：${raw}`;
  return `飞书接口返回错误：${raw}`;
}

export async function feishuFetch<T = unknown>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(init.query || {})) if (v !== undefined && v !== "") q.set(k, String(v));
  const url = `${BASE}${path}${q.toString() ? `?${q}` : ""}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await tenantToken(attempt > 0);
    const res = await fetch(url, {
      method: init.method || "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; data?: T };
    if (data.code === 99991663 || data.code === 99991661 || data.code === 99991668) continue; // 令牌过期，刷新后重试一次
    if (data.code !== 0) throw new FeishuApiError(explain(data.code, data.msg, path), data.code);
    return (data.data ?? ({} as T)) as T;
  }
  throw new FeishuApiError("飞书令牌刷新失败，请稍后重试");
}

// ———————————————————— 链接解析 ————————————————————

export type TableKind = "sheet" | "bitable";
export type ParsedLink = { kind: TableKind; token: string; tableId?: string };

/** 支持 /sheets/xxx?sheet=、/base/xxx?table=、/wiki/xxx（知识库里的表格，会查一次真实类型） */
export async function resolveTableLink(input: string): Promise<ParsedLink> {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new FeishuApiError("链接格式不对：请粘贴飞书表格的完整网址");
  }
  if (!/(^|\.)feishu\.cn$/.test(u.hostname)) throw new FeishuApiError("目前只支持飞书（feishu.cn）的表格链接");
  const seg = u.pathname.split("/").filter(Boolean);
  const pick = (name: string) => {
    const i = seg.indexOf(name);
    return i >= 0 ? seg[i + 1] : undefined;
  };
  const sheet = pick("sheets");
  if (sheet) return { kind: "sheet", token: sheet, tableId: u.searchParams.get("sheet") || undefined };
  const base = pick("base");
  if (base) return { kind: "bitable", token: base, tableId: u.searchParams.get("table") || undefined };
  const wiki = pick("wiki");
  if (wiki) {
    const d = await feishuFetch<{ node?: { obj_type?: string; obj_token?: string } }>("/wiki/v2/spaces/get_node", { query: { token: wiki } });
    const t = d.node?.obj_type;
    if (t === "sheet" && d.node?.obj_token) return { kind: "sheet", token: d.node.obj_token, tableId: u.searchParams.get("sheet") || undefined };
    if (t === "bitable" && d.node?.obj_token) return { kind: "bitable", token: d.node.obj_token, tableId: u.searchParams.get("table") || undefined };
    throw new FeishuApiError("这个知识库页面不是电子表格或多维表格");
  }
  throw new FeishuApiError("没认出表格类型：请粘贴电子表格（/sheets/）或多维表格（/base/）的链接");
}

// ———————————————————— 单元格文本 ————————————————————

/** 单元格里的图片 / 附件：电子表格的嵌入图片（fileToken）、多维表格的附件（file_token） */
export type CellImage = { token: string; name: string; mime: string };
export function cellImages(v: unknown, out: CellImage[] = []): CellImage[] {
  if (Array.isArray(v)) v.forEach((x) => cellImages(x, out));
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const token = (o.fileToken || o.file_token) as string | undefined;
    if (typeof token === "string" && token) {
      const mime = String(o.type || o.mime_type || "");
      // 多维表格附件只要图片；电子表格嵌入图片 type 为 embed-image
      if (!mime || mime.startsWith("image/") || mime === "embed-image") out.push({ token, name: String(o.name || "图片"), mime: mime.startsWith("image/") ? mime : "" });
    } else for (const x of Object.values(o)) if (x && typeof x === "object") cellImages(x, out);
  }
  return out;
}

export function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(cellText).filter(Boolean).join("、");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ((o.fileToken || o.file_token) && typeof o.text !== "string") return ""; // 图片 / 附件不算文字
    if (typeof o.text === "string") return o.text.trim();
    if (Array.isArray(o.text)) return o.text.map(cellText).join("");
    if (typeof o.name === "string") return o.name.trim();
    if (typeof o.link === "string") return o.link;
    if (Array.isArray(o.value)) return o.value.map(cellText).join("、");
  }
  return String(v).trim();
}

export function colLetter(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ———————————————————— 电子表格 ————————————————————

export type SheetInfo = { id: string; title: string; rows: number; cols: number };

export async function listSheets(token: string): Promise<SheetInfo[]> {
  const d = await feishuFetch<{ sheets?: { sheet_id: string; title: string; index?: number; grid_properties?: { row_count?: number; column_count?: number } }[] }>(
    `/sheets/v3/spreadsheets/${encodeURIComponent(token)}/sheets/query`,
  );
  return (d.sheets || [])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((s) => ({ id: s.sheet_id, title: s.title, rows: s.grid_properties?.row_count || 0, cols: s.grid_properties?.column_count || 0 }));
}

/** 读取整张工作表（最多 5000 行、78 列），保留单元格原始结构（@人、链接、嵌入图片） */
export async function readSheetRaw(token: string, sheet: SheetInfo): Promise<unknown[][]> {
  const cols = Math.min(Math.max(sheet.cols, 1), 78);
  const rows = Math.min(Math.max(sheet.rows, 1), 5000);
  const d = await feishuFetch<{ valueRange?: { values?: unknown[][] } }>(
    `/sheets/v2/spreadsheets/${encodeURIComponent(token)}/values/${encodeURIComponent(`${sheet.id}!A1:${colLetter(cols - 1)}${rows}`)}`,
    { query: { valueRenderOption: "FormattedValue", dateTimeRenderOption: "FormattedString" } },
  );
  return (d.valueRange?.values || []).map((r) => r || []);
}

/** 同上，转成纯文本矩阵 */
export async function readSheet(token: string, sheet: SheetInfo): Promise<string[][]> {
  return (await readSheetRaw(token, sheet)).map((r) => r.map(cellText));
}

/** 下载云文档里的图片 / 附件（电子表格嵌入图片、多维表格附件），需要应用开通 drive:drive:readonly 或 docs:document.media:download */
export async function downloadMedia(fileToken: string): Promise<{ data: Buffer; mime: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await tenantToken(attempt > 0);
    const res = await fetch(`${BASE}/drive/v1/medias/${encodeURIComponent(fileToken)}/download`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const type = res.headers.get("content-type") || "";
    if (res.ok && !type.includes("application/json")) {
      return { data: Buffer.from(await res.arrayBuffer()), mime: type.split(";")[0].trim() };
    }
    const d = (await res.json().catch(() => ({}))) as { code?: number; msg?: string };
    if (d.code === 99991663 || d.code === 99991661 || d.code === 99991668) continue;
    throw new FeishuApiError(explain(d.code, d.msg || String(res.status), "/drive/"), d.code);
  }
  throw new FeishuApiError("飞书令牌刷新失败，请稍后重试");
}

export async function writeSheetCells(token: string, cells: { range: string; value: string }[]) {
  for (let i = 0; i < cells.length; i += 200) {
    const part = cells.slice(i, i + 200);
    await feishuFetch(`/sheets/v2/spreadsheets/${encodeURIComponent(token)}/values_batch_update`, {
      method: "POST",
      body: { valueRanges: part.map((c) => ({ range: c.range, values: [[c.value]] })) },
    });
  }
}

/** 在表格末尾追加若干行，返回新行的行号（1 起） */
export async function appendSheetRows(token: string, sheetId: string, width: number, rows: string[][]): Promise<number[]> {
  if (!rows.length) return [];
  const d = await feishuFetch<{ updates?: { updatedRange?: string } }>(`/sheets/v2/spreadsheets/${encodeURIComponent(token)}/values_append`, {
    method: "POST",
    query: { insertDataOption: "INSERT_ROWS" },
    body: { valueRange: { range: `${sheetId}!A1:${colLetter(Math.max(width, 1) - 1)}${rows.length}`, values: rows } },
  });
  const m = d.updates?.updatedRange?.match(/![A-Z]+(\d+):[A-Z]+(\d+)/);
  if (!m) return [];
  const start = Number(m[1]);
  return rows.map((_, i) => start + i);
}

// ———————————————————— 多维表格 ————————————————————

export type BitableField = { id: string; name: string; type: number };
export type BitableRecord = { id: string; fields: Record<string, unknown> };

export async function listBitableTables(app: string): Promise<{ id: string; title: string }[]> {
  const d = await feishuFetch<{ items?: { table_id: string; name: string }[] }>(`/bitable/v1/apps/${encodeURIComponent(app)}/tables`, { query: { page_size: 100 } });
  return (d.items || []).map((t) => ({ id: t.table_id, title: t.name }));
}

export async function listBitableFields(app: string, table: string): Promise<BitableField[]> {
  const d = await feishuFetch<{ items?: { field_id: string; field_name: string; type: number }[] }>(
    `/bitable/v1/apps/${encodeURIComponent(app)}/tables/${encodeURIComponent(table)}/fields`,
    { query: { page_size: 100 } },
  );
  return (d.items || []).map((f) => ({ id: f.field_id, name: f.field_name, type: f.type }));
}

export async function listBitableRecords(app: string, table: string, limit = 5000): Promise<BitableRecord[]> {
  const out: BitableRecord[] = [];
  let pageToken: string | undefined;
  do {
    const d = await feishuFetch<{ items?: { record_id: string; fields: Record<string, unknown> }[]; has_more?: boolean; page_token?: string }>(
      `/bitable/v1/apps/${encodeURIComponent(app)}/tables/${encodeURIComponent(table)}/records`,
      { query: { page_size: 500, page_token: pageToken } },
    );
    for (const r of d.items || []) out.push({ id: r.record_id, fields: r.fields || {} });
    pageToken = d.has_more ? d.page_token : undefined;
  } while (pageToken && out.length < limit);
  return out;
}

export async function updateBitableRecords(app: string, table: string, records: { id: string; fields: Record<string, unknown> }[]) {
  for (let i = 0; i < records.length; i += 500) {
    await feishuFetch(`/bitable/v1/apps/${encodeURIComponent(app)}/tables/${encodeURIComponent(table)}/records/batch_update`, {
      method: "POST",
      body: { records: records.slice(i, i + 500).map((r) => ({ record_id: r.id, fields: r.fields })) },
    });
  }
}

export async function createBitableRecords(app: string, table: string, rows: Record<string, unknown>[]): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const d = await feishuFetch<{ records?: { record_id: string }[] }>(`/bitable/v1/apps/${encodeURIComponent(app)}/tables/${encodeURIComponent(table)}/records/batch_create`, {
      method: "POST",
      body: { records: rows.slice(i, i + 500).map((fields) => ({ fields })) },
    });
    for (const r of d.records || []) ids.push(r.record_id);
  }
  return ids;
}

// ———————————————————— 消息 ————————————————————

/** 以应用机器人身份私信（需应用开启机器人能力并开通 im:message:send_as_bot） */
export async function sendDirectCard(openId: string, card: unknown) {
  await feishuFetch("/im/v1/messages", {
    method: "POST",
    query: { receive_id_type: "open_id" },
    body: { receive_id: openId, msg_type: "interactive", content: JSON.stringify(card) },
  });
}
