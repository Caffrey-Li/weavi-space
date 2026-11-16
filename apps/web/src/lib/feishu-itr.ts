import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { ITR_DOC, assertItrDocConfigured, type ItrSheetRow } from "./itr-sync";

const execFileAsync = promisify(execFile);

type FeishuValuesResponse = {
  code?: number;
  msg?: string;
  data?: { valueRange?: { values?: unknown[][] } };
};

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return String(v).trim();
  }
  if (Array.isArray(v)) {
    return v.map(cellText).filter(Boolean).join(",");
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text.trim();
    if (Array.isArray(o.text)) return o.text.map(cellText).join("");
    if (typeof o.name === "string") return o.name.trim();
  }
  return String(v).trim();
}

export function valuesToRows(matrix: unknown[][]): ItrSheetRow[] {
  if (!matrix?.length) return [];
  let headerIdx = -1;
  for (let i = 0; i < Math.min(matrix.length, 5); i++) {
    const row = matrix[i] || [];
    const c0 = cellText(row[0]);
    if (c0 === "序号" || cellText(row[1]) === "模块") {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) headerIdx = 1;

  const out: ItrSheetRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cols = matrix[i] || [];
    const get = (idx: number) => cellText(cols[idx]);
    const moduleName = get(1);
    const featureModule = get(2);
    const feature = get(3);
    if (!moduleName && !featureModule && !feature) continue;
    out.push({
      row: i + 1, // 1-based sheet row
      seq: get(0),
      module: moduleName,
      featureModule,
      feature,
      priority: get(4),
      status: get(5),
      plannedOnlineAt: get(6),
      onlineAt: get(7),
      plannedEndAt: get(8),
      actualStartAt: get(9),
      actualEndAt: get(10),
      feProgress: get(11),
      beProgress: get(12),
      qaProgress: get(13),
      owner: get(14),
      frontend: get(15),
      backend: get(16),
      remark: get(17),
      zentaoId: get(18),
      relatedSystems: get(19),
    });
  }
  return out;
}

async function getTenantAccessToken() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) return null;
  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = (await res.json()) as { code?: number; tenant_access_token?: string; msg?: string };
  if (data.code !== 0 || !data.tenant_access_token) return null;
  return data.tenant_access_token;
}

/** Prefer user token (sheet usually not shared to app/bot). */
export async function fetchItrRowsViaApi(): Promise<ItrSheetRow[]> {
  const userToken = process.env.FEISHU_USER_ACCESS_TOKEN;
  const token = userToken || (await getTenantAccessToken());
  if (!token) {
    throw new Error(
      "缺少飞书凭证：请配置 FEISHU_USER_ACCESS_TOKEN（推荐），或 FEISHU_APP_ID + FEISHU_APP_SECRET（需把表格授权给应用）",
    );
  }

  const spreadsheetToken =
    process.env.FEISHU_ITR_SPREADSHEET_TOKEN || ITR_DOC.spreadsheetToken;
  const sheetId = process.env.FEISHU_ITR_SHEET_ID || ITR_DOC.sheetId;
  const range = `${sheetId}!A1:T200`;
  const url = `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}?valueRenderOption=ToString`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as FeishuValuesResponse;
  if (data.code !== 0) {
    throw new Error(`飞书表格读取失败: code=${data.code} msg=${data.msg || res.statusText}`);
  }
  return valuesToRows(data.data?.valueRange?.values || []);
}

export async function fetchItrRowsViaLarkCli(): Promise<ItrSheetRow[]> {
  const spreadsheetToken =
    process.env.FEISHU_ITR_SPREADSHEET_TOKEN || ITR_DOC.spreadsheetToken;
  const sheetId = process.env.FEISHU_ITR_SHEET_ID || ITR_DOC.sheetId;
  const outPath = path.join(process.cwd(), "tmp", `itr-cli-${Date.now()}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  try {
    await execFileAsync(
      "lark-cli",
      [
        "sheets",
        "+csv-get",
        "--spreadsheet-token",
        spreadsheetToken,
        "--sheet-id",
        sheetId,
        "--range",
        "A1:T200",
        "--as",
        "user",
        "--include-row-prefix=false",
        "--output-path",
        outPath,
      ],
      { timeout: 120000, maxBuffer: 20 * 1024 * 1024 },
    );
  } catch (e) {
    // older CLI may use different flags; surface message
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`lark-cli 拉取失败（可用 lark-cli auth login 刷新用户登录）: ${msg}`);
  }

  const raw = JSON.parse(await fs.readFile(outPath, "utf8")) as {
    annotated_csv?: string;
    csv?: string;
  };
  // 导出文件含业务数据，读完就删
  await fs.unlink(outPath).catch(() => undefined);
  const csvText = raw.annotated_csv || raw.csv || "";
  // parse CSV into matrix
  const matrix = parseCsv(csvText);
  return valuesToRows(matrix);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    if (ch === "\r") continue;
    cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

export async function loadItrRowsFromFile(filePath: string): Promise<ItrSheetRow[]> {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (Array.isArray(raw)) return raw as ItrSheetRow[];
  if (raw?.annotated_csv) return valuesToRows(parseCsv(raw.annotated_csv));
  if (Array.isArray(raw?.rows)) return raw.rows as ItrSheetRow[];
  throw new Error(`无法识别的 ITR 数据文件: ${filePath}`);
}

export type FetchMode = "auto" | "cli" | "api" | "file";

export async function fetchItrRows(mode: FetchMode = "auto", filePath?: string) {
  assertItrDocConfigured();
  if (mode === "file" || filePath) {
    return loadItrRowsFromFile(filePath || path.join(process.cwd(), "tmp", "itr-rows.json"));
  }
  if (mode === "cli") return fetchItrRowsViaLarkCli();
  if (mode === "api") return fetchItrRowsViaApi();

  // auto: live CLI → API → local snapshot fallback
  const errors: string[] = [];
  try {
    return await fetchItrRowsViaLarkCli();
  } catch (cliErr) {
    errors.push(`CLI: ${cliErr instanceof Error ? cliErr.message : String(cliErr)}`);
  }
  try {
    return await fetchItrRowsViaApi();
  } catch (apiErr) {
    errors.push(`API: ${apiErr instanceof Error ? apiErr.message : String(apiErr)}`);
  }
  const snapshot = path.join(process.cwd(), "tmp", "itr-rows.json");
  try {
    await fs.access(snapshot);
    const rows = await loadItrRowsFromFile(snapshot);
    if (rows.length) return rows;
  } catch {
    /* continue */
  }
  throw new Error(`自动拉取失败（已尝试 CLI / API / 本地快照）。${errors.join("；")}`);
}
