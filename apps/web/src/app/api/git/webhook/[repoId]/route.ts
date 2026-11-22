import { NextResponse } from "next/server";
import { handleWebhook } from "@pm-collab/core/git/service";

export const dynamic = "force-dynamic";

/**
 * GitLab Webhook（T44）：不带 Cookie，只认请求头 X-Gitlab-Token（绑定仓库时生成的密钥）。
 * proxy 对这个路径不做 Origin 校验（GitLab 服务器发来的请求没有浏览器来源）。
 */
export async function POST(req: Request, props: { params: Promise<{ repoId: string }> }) {
  const raw = await req.text();
  if (raw.length > 5_000_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const r = await handleWebhook((await props.params).repoId, req.headers.get("x-gitlab-token"), payload);
  return NextResponse.json(r.body, r.init);
}
