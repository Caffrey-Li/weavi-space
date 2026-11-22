import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deliveryPrototype } from "@pm-collab/core/delivery/service";

export const dynamic = "force-dynamic";

/** T58 需求交付的原型（HTML）：和需求资料的 HTML 原型一样只在沙箱里打开；?v=live 是生成中的实时内容 */
const HTML_CSP =
  "sandbox allow-scripts allow-modals allow-popups; default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const v = new URL(req.url).searchParams.get("v");
  const f = await deliveryPrototype(s, (await props.params).id, v).catch(() => null);
  if (!f) return NextResponse.json({ error: "原型不存在" }, { status: 404 });
  return new NextResponse(new Uint8Array(f.data), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": HTML_CSP,
      "X-Frame-Options": "SAMEORIGIN",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
