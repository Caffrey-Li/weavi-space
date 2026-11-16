import { NextResponse } from "next/server";
import path from "path";
import { readUpload } from "@/lib/upload-store";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export async function GET(_req: Request, props: { params: Promise<{ filename: string }> }) {
  const params = await props.params;
  const filename = path.basename(params.filename || "");
  if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif|svg)$/.test(filename)) {
    return NextResponse.json({ error: "无效文件" }, { status: 400 });
  }
  const buf = await readUpload("projects", filename);
  if (!buf) return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  const ext = filename.split(".").pop()!.toLowerCase();
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=0, must-revalidate",
      // 自动生成的图标是 SVG：禁止脚本和外部资源
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
