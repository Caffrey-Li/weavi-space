import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { artifactFile } from "@pm-collab/core/requirements/artifacts";

export const dynamic = "force-dynamic";

/**
 * 需求资料的文件内容（T42）。
 * - HTML 原型：只在沙箱里打开（CSP sandbox 不带 allow-same-origin = 不透明来源，读不到 Cookie、调不了本站接口；
 *   connect-src 'none' 不能发请求，form-action 'none' 不能提交表单）。只允许被本站页面嵌入。
 *   响应头在 next.config.mjs 里对 /api/artifact-raw/* 单独配置，这里再写一遍兜底。
 * - 图片内联显示；其余一律下载。
 */
const HTML_CSP =
  "sandbox allow-scripts allow-modals allow-popups; default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const att = await artifactFile(s, (await props.params).id);
  if (!att) return NextResponse.json({ error: "资料不存在" }, { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  const html = att.mime === "text/html";
  const inline = !download && (html || att.mime.startsWith("image/"));
  const headers: Record<string, string> = {
    "Content-Type": html ? "text/html; charset=utf-8" : att.mime,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.name)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": html ? HTML_CSP : "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox",
    "X-Frame-Options": "SAMEORIGIN",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  return new NextResponse(new Uint8Array(att.data), { status: 200, headers });
}
