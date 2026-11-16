import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReadAttachment } from "@/lib/attachments";

/**
 * 读附件：可见范围见 canReadAttachment（跟随挂载对象的数据范围）。
 * 图片内联显示；其余一律下载，不在本站域名下渲染用户上传的内容。
 */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const att = await prisma.attachment.findUnique({ where: { id: params.id } });
  if (!att || !(await canReadAttachment(session, att))) return NextResponse.json({ error: "附件不存在" }, { status: 404 });
  const inline = att.mime.startsWith("image/");
  return new NextResponse(new Uint8Array(att.data), {
    status: 200,
    headers: {
      "Content-Type": att.mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.name)}`,
      "X-Content-Type-Options": "nosniff",
      // 附件内容不会改，地址即版本
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
