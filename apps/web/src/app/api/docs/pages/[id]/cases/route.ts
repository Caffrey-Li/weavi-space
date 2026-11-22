import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { importPageCases, savePageCase } from "@pm-collab/core/delivery/standalone-cases";

/** 手动新建的用例页（T42）：{ action: "saveCase", code, case | null } 增改删；{ action: "import", text, mode } 导入 CSV / JSON */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await props.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = body.action === "saveCase" ? await savePageCase(s, id, body) : body.action === "import" ? await importPageCases(s, id, body) : { body: { error: "未知操作" }, init: { status: 400 } };
  return NextResponse.json(r.body, r.init);
}
