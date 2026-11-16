import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UPLOAD_MAX_BYTES, cleanFileName, fileMatchesType, sniffImage } from "@/lib/upload-guard";

// 前端会把大图压到 1600px 宽；附件兜底限制大小（字节直接存库，同项目背景图）
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const FILE_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

/** 上传富文本里的配图 / 附件，返回可插入正文的地址 */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file || typeof file === "string" || !file.size) {
      return NextResponse.json({ error: "请选择要上传的文件" }, { status: 400 });
    }
    if (file.size > UPLOAD_MAX_BYTES) return NextResponse.json({ error: "单个文件不能超过 5MB" }, { status: 400 });
    const claimed = (file.type || "").toLowerCase();
    const kind = form.get("kind") === "image" ? "image" : "file";
    const data = Buffer.from(await file.arrayBuffer());
    // 类型以文件内容为准，浏览器报的 Content-Type 只用来区分内容相同的格式（如 docx 和 zip）
    const image = sniffImage(data);
    const mime = image ? image.mime : kind === "file" && FILE_TYPES.includes(claimed) && fileMatchesType(claimed, data) ? claimed : null;
    if (!mime || (kind === "image" && !IMAGE_TYPES.includes(mime))) {
      return NextResponse.json(
        { error: kind === "image" ? "仅支持 JPEG / PNG / WebP / GIF 图片" : "不支持该文件类型，或文件内容与类型不符" },
        { status: 400 },
      );
    }
    // 先按草稿存（只有上传者能读），保存正文时由 linkAttachments 挂到需求 / Bug 上。不接受客户端指定归属
    const att = await prisma.attachment.create({
      data: {
        ownerType: "requirement",
        ownerId: null,
        name: cleanFileName(file.name || "", "附件"),
        mime,
        size: data.length,
        data,
        uploaderId: session.id,
      },
      select: { id: true, name: true, mime: true, size: true },
    });
    return NextResponse.json({ ...att, url: `/api/attachments/${att.id}` });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "上传失败，请稍后重试" }, { status: 500 });
  }
}
