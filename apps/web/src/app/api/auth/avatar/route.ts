import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { randomUploadName, removeUploadByUrl, removeUploadsFor, writeUpload } from "@/lib/upload-store";
import { readImageUpload } from "@/lib/upload-guard";

const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const form = await req.formData();
    const file = (form.get("file") || form.get("avatar")) as File | null;
    if (!file || typeof file === "string" || !file.size) {
      return NextResponse.json({ error: "请选择要上传的图片" }, { status: 400 });
    }
    const image = await readImageUpload(file, { max: MAX_BYTES });
    if ("error" in image) return NextResponse.json({ error: image.error }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { id: session.id } });
    if (!user || !user.isActive) {
      return NextResponse.json({ error: "用户不存在或已停用" }, { status: 404 });
    }

    const filename = randomUploadName(image.ext);
    await writeUpload("avatars", filename, image.data);
    await removeUploadsFor("avatars", user.id);
    await removeUploadByUrl("avatars", user.avatarUrl);

    const avatarUrl = `/uploads/avatars/${filename}`;
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl },
    });

    return NextResponse.json({ ok: true, avatarUrl: updated.avatarUrl });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "上传头像失败，请稍后重试" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.id } });
    if (!user || !user.isActive) {
      return NextResponse.json({ error: "用户不存在或已停用" }, { status: 404 });
    }

    await removeUploadsFor("avatars", user.id);
    await removeUploadByUrl("avatars", user.avatarUrl);
    await prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: null },
    });

    return NextResponse.json({ ok: true, avatarUrl: null });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "清除头像失败，请稍后重试" }, { status: 500 });
  }
}
