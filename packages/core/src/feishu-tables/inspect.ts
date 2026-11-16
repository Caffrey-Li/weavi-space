import type { SessionUser } from "../auth";
import { result } from "./result";
import { can } from "../permissions";
import { FeishuApiError, cellImages, listBitableTables, listSheets, resolveTableLink } from "../shared/feishu-api";
import { loadTable } from "../shared/feishu-table-sync";

function serviceApiError(e: unknown) {
  if (e instanceof FeishuApiError) return result({ error: e.message }, { status: 400 });
  console.error("[飞书表格]", e);
  return result({ error: "操作失败，请稍后重试" }, { status: 500 });
}

/** 读取链接：识别类型、列出工作表 / 数据表、读出表头和记录数，供新建连接时做字段映射 */
export async function POST(session: SessionUser, body: { url?: string; tableId?: string; headerRow?: number }) {
  // 用的是系统的飞书应用凭据：只有能建连接的人才能读表格内容
  if (!(await can(session, "requirements.create"))) return result({ error: "无权限：需要新建需求的权限" }, { status: 403 });
  try {
    const parsed = await resolveTableLink(body.url || "");
    const tables = parsed.kind === "sheet" ? (await listSheets(parsed.token)).map((s) => ({ id: s.id, title: s.title })) : await listBitableTables(parsed.token);
    const tableId = body.tableId && tables.some((t) => t.id === body.tableId) ? body.tableId : parsed.tableId && tables.some((t) => t.id === parsed.tableId) ? parsed.tableId : tables[0]?.id;
    if (!tableId) return result({ error: "这份表格里没有工作表 / 数据表" }, { status: 400 });
    const table = await loadTable({ kind: parsed.kind, token: parsed.token, tableId, headerRow: Number(body.headerRow) || 0 });
    const rows = table.rows.filter((r) => Object.values(r.cells).some((v) => v !== "" && v != null)).length;
    // 每列有多少张单元格图片：映射描述时提示「含 N 张图片」
    const imageCols: Record<string, number> = {};
    for (const r of table.rows) for (const [c, v] of Object.entries(r.cells)) {
      const n = cellImages(v).length;
      if (n) imageCols[c] = (imageCols[c] || 0) + n;
    }
    return result({ kind: parsed.kind, tables, tableId, columns: table.columns, rows, headerRow: table.headerRow, imageCols });
  } catch (e) {
    return serviceApiError(e);
  }
}
