import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { answerByModel, answerByRules, loadAssistantContext } from "@/lib/assistant";
import { canSeeProject } from "@/lib/access";

/** 看板 AI 助手：配置了 ANTHROPIC_API_KEY 用 Claude，否则用固定规则从数据库直接计算 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { message?: string; projectId?: string };
  const message = String(body.message || "").trim().slice(0, 500);
  if (!message) return NextResponse.json({ error: "请输入问题" }, { status: 400 });
  const projectId = body.projectId ? String(body.projectId) : undefined;

  if (projectId && !(await canSeeProject(session, projectId))) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  const ctx = await loadAssistantContext(session, projectId);
  try {
    const ai = await answerByModel(message, ctx, session);
    if (ai) return NextResponse.json(ai);
  } catch (e) {
    console.error("[AI 助手]", e);
    const fallback = answerByRules(message, ctx, session);
    return NextResponse.json({
      ...fallback,
      text: `大模型暂时不可用，先用内置规则回答。\n${fallback.text || ""}`,
    });
  }
  return NextResponse.json(answerByRules(message, ctx, session));
}
