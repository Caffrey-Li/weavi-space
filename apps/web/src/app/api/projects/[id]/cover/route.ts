import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { canSeeProject } from "@/lib/access";
import { readImageUpload } from "@/lib/upload-guard";

// 前端会先压缩到 1600px 宽的 JPEG/WebP；这里兜底限制大小
const MAX_BYTES = 3 * 1024 * 1024;

/** 读背景图：图片存在 project_covers 表里，不依赖本地磁盘 */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!(await canSeeProject(session, params.id))) return NextResponse.json({ error: "没有背景图" }, { status: 404 });
  const cover = await prisma.projectCover.findUnique({ where: { projectId: params.id } });
  if (!cover) return NextResponse.json({ error: "没有背景图" }, { status: 404 });
  return new NextResponse(new Uint8Array(cover.data), {
    status: 200,
    headers: {
      "Content-Type": cover.mime,
      // 地址带 ?v=更新时间，换图后地址会变，可以放心长缓存
      "Cache-Control": "private, max-age=31536000, immutable",
      // 自动生成的背景图是 SVG：禁止脚本和外部资源
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file || typeof file === "string" || !file.size) {
      return NextResponse.json({ error: "请选择要上传的图片" }, { status: 400 });
    }
    const image = await readImageUpload(file, { max: MAX_BYTES });
    if ("error" in image) return NextResponse.json({ error: image.error }, { status: 400 });

    const project = await prisma.project.findUnique({ where: { id: params.id } });
    if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    if (!(await can(session, "project.edit", params.id))) {
      return NextResponse.json({ error: "无权限编辑项目信息" }, { status: 403 });
    }

    const { data, mime } = image;
    const coverUrl = `/api/projects/${params.id}/cover?v=${Date.now()}`;
    await prisma.$transaction([
      prisma.projectCover.upsert({
        where: { projectId: params.id },
        create: { projectId: params.id, mime, data },
        update: { mime, data },
      }),
      prisma.project.update({ where: { id: params.id }, data: { coverUrl } }),
      prisma.activityLog.create({
        data: { entityType: "project", entityId: params.id, action: "updated", actorId: session.id, message: "更新了项目背景图" },
      }),
    ]);
    return NextResponse.json({ ok: true, coverUrl });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "上传背景图失败，请稍后重试" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const project = await prisma.project.findUnique({ where: { id: params.id } });
    if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    if (!(await can(session, "project.edit", params.id))) {
      return NextResponse.json({ error: "无权限编辑项目信息" }, { status: 403 });
    }
    await prisma.$transaction([
      prisma.projectCover.deleteMany({ where: { projectId: params.id } }),
      prisma.project.update({ where: { id: params.id }, data: { coverUrl: null } }),
    ]);
    return NextResponse.json({ ok: true, coverUrl: null });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "清除背景图失败，请稍后重试" }, { status: 500 });
  }
}
