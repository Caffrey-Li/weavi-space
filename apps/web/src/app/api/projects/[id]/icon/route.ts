import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { randomUploadName, removeUploadByUrl, removeUploadsFor, writeUpload } from "@/lib/upload-store";
import { readImageUpload } from "@/lib/upload-guard";

const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!(await can(session, "project.edit", params.id))) {
      return NextResponse.json({ error: "无权限编辑项目信息" }, { status: 403 });
    }

    const project = await prisma.project.findUnique({ where: { id: params.id } });
    if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

    const form = await req.formData();
    const file = (form.get("file") || form.get("icon")) as File | null;
    if (!file || typeof file === "string" || !file.size) {
      return NextResponse.json({ error: "请选择要上传的图片" }, { status: 400 });
    }
    const image = await readImageUpload(file, { max: MAX_BYTES });
    if ("error" in image) return NextResponse.json({ error: image.error }, { status: 400 });

    const filename = randomUploadName(image.ext);
    await writeUpload("projects", filename, image.data);
    await removeUploadsFor("projects", params.id);
    await removeUploadByUrl("projects", project.iconUrl);

    const iconUrl = `/uploads/projects/${filename}`;
    const updated = await prisma.project.update({
      where: { id: params.id },
      data: { iconUrl },
    });

    return NextResponse.json({ ok: true, iconUrl: updated.iconUrl });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "上传项目图标失败，请稍后重试" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!(await can(session, "project.edit", params.id))) {
      return NextResponse.json({ error: "无权限编辑项目信息" }, { status: 403 });
    }

    const project = await prisma.project.findUnique({ where: { id: params.id } });
    if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

    await removeUploadsFor("projects", params.id);
    await removeUploadByUrl("projects", project.iconUrl);
    await prisma.project.update({
      where: { id: params.id },
      data: { iconUrl: null },
    });

    return NextResponse.json({ ok: true, iconUrl: null });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "清除项目图标失败，请稍后重试" }, { status: 500 });
  }
}
