import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { generateTitleServer } from "@/lib/title-gen";

export const dynamic = "force-dynamic";

/** 根据描述生成 20 字以内的标题 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { html?: string; text?: string; kind?: string };
  const html = String(body.html ?? body.text ?? "").slice(0, 200_000);
  const kind = body.kind === "bug" ? "bug" : "requirement";
  const out = await generateTitleServer(html, kind);
  if (!out.title) return NextResponse.json({ error: "描述里还没有可提炼的内容" }, { status: 400 });
  return NextResponse.json(out);
}
