import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ArtError, applyAiArt, applyPatternArt } from "@/lib/project-art";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 自动生成项目配图（Figma 42）
 * POST { target: "cover" | "icon", mode: "pattern" | "ai", style?, seed? }
 * pattern：内置生成，立即保存；ai：调用「系统 › AI 生图」配置的接口
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  if (!(await can(session, "project.edit", params.id))) return NextResponse.json({ error: "无权限编辑项目信息" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { target?: string; mode?: string; style?: string; seed?: number };
  const target = body.target === "icon" ? "icon" : "cover";
  const seed = Number.isFinite(body.seed) ? Number(body.seed) : Math.floor(Math.random() * 1e9);
  try {
    const out =
      body.mode === "ai"
        ? await applyAiArt(params.id, target, session.id)
        : await applyPatternArt(params.id, { cover: target === "cover", icon: target === "icon", style: body.style, seed });
    await prisma.activityLog.create({
      data: {
        entityType: "project",
        entityId: params.id,
        action: "updated",
        actorId: session.id,
        message: `${body.mode === "ai" ? "用 AI 生成了" : "自动生成了"}项目${target === "icon" ? "图标" : "背景图"}`,
      },
    });
    return NextResponse.json({ ok: true, seed, ...out });
  } catch (e) {
    if (e instanceof ArtError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[配图]", e);
    return NextResponse.json({ error: "生成失败，请稍后重试" }, { status: 500 });
  }
}
