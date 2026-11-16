import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncItrRows, ITR_DOC } from "@/lib/itr-sync";
import { fetchItrRows, type FetchMode } from "@/lib/feishu-itr";
import { z } from "zod";

const MODES: FetchMode[] = ["auto", "cli", "api", "file"];
/** 表格一行都是短文本；上限防止一次塞入超大数据 */
const Rows = z.array(z.object({ row: z.number().int() }).catchall(z.union([z.string().max(5000), z.number(), z.null()]))).max(2000);

/** ITR 同步写入的是固定的 ITR 项目，属于系统级操作：只有系统管理员 */
function canSync(session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  return session.globalRole === "admin";
}

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canSync(session)) return NextResponse.json({ error: "无权限同步需求（需要系统管理员）" }, { status: 403 });

  let body: {
    mode?: FetchMode;
    rows?: unknown[];
    dryRun?: boolean;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    let rows: Parameters<typeof syncItrRows>[0];
    if (Array.isArray(body.rows) && body.rows.length) {
      const parsed = Rows.safeParse(body.rows);
      if (!parsed.success) return NextResponse.json({ error: "排期行格式不对" }, { status: 400 });
      rows = parsed.data as unknown as Parameters<typeof syncItrRows>[0];
    } else {
      // 不接受客户端传文件路径：mode=file 只读固定的 tmp/itr-rows.json
      rows = await fetchItrRows(MODES.includes(body.mode as FetchMode) ? body.mode : "auto");
    }

    if (!rows.length) {
      return NextResponse.json({ error: "未读到任何排期行", source: ITR_DOC }, { status: 400 });
    }

    const result = await syncItrRows(rows, {
      actorId: session.id,
      dryRun: Boolean(body.dryRun),
    });

    if (!body.dryRun) await logRun(session.id, result.projectId, { created: result.created, updated: result.updated, skipped: result.skipped, errors: result.errors.slice(0, 5), failed: result.errors.length });

    return NextResponse.json({
      ok: true,
      source: ITR_DOC,
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logRun(session.id, "", { created: 0, updated: 0, skipped: 0, errors: [message], failed: 1, error: true });
    console.error("[ITR 同步]", e);
    return NextResponse.json(
      {
        error: "同步失败，详情见「最近同步记录」",
        source: ITR_DOC,
        hint: "可先在本机执行 lark-cli auth login，或提供 FEISHU_USER_ACCESS_TOKEN；也可把导出的 tmp/itr-rows.json 放在项目下后 mode=file。",
      },
      { status: 500 },
    );
  }
}

/** 每次同步记一条运行记录，供「设置 · ITR 同步」展示最近同步记录 */
async function logRun(actorId: string, projectId: string, summary: Record<string, unknown>) {
  try {
    await prisma.activityLog.create({
      data: { entityType: "project", entityId: projectId, action: "itr_sync_run", actorId, message: JSON.stringify(summary) },
    });
  } catch {
    /* 记录失败不影响同步结果 */
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!canSync(session)) return NextResponse.json({ error: "无权限查看" }, { status: 403 });
  return NextResponse.json({
    source: ITR_DOC,
    env: {
      hasAppId: Boolean(process.env.FEISHU_APP_ID),
      hasUserToken: Boolean(process.env.FEISHU_USER_ACCESS_TOKEN),
      spreadsheetToken: process.env.FEISHU_ITR_SPREADSHEET_TOKEN || ITR_DOC.spreadsheetToken,
      sheetId: process.env.FEISHU_ITR_SHEET_ID || ITR_DOC.sheetId,
    },
  });
}
