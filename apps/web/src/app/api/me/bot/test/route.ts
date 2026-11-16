import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildCard, deliver, siteUrl } from "@/lib/feishu-bot";

export const dynamic = "force-dynamic";

/** 发送测试消息：channel 不传时发到所有已开启的渠道 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { channel?: "webhook" | "dm" };
  const card = buildCard({ title: "小围空间测试消息", lines: [`你好 ${session.name}，这条消息说明机器人已经配置好了。`, "之后的需求、Bug 变更通知和定时任务都会发到这里。"], url: siteUrl("/settings/bot"), button: "打开机器人设置", tone: "green" });
  const results = await deliver(session.id, card, body.channel || "both");
  const ok = results.length > 0 && results.every((r) => r.ok);
  await prisma.userBot.update({ where: { userId: session.id }, data: { lastTestAt: new Date(), lastTestOk: ok, ...(ok ? { lastError: null } : {}) } }).catch(() => {});
  if (!results.length) return NextResponse.json({ error: "还没有开启任何发送渠道" }, { status: 400 });
  if (!ok) return NextResponse.json({ error: results.filter((r) => !r.ok).map((r) => `${r.channel === "dm" ? "私信" : "群机器人"}：${r.error}`).join("；"), results }, { status: 400 });
  return NextResponse.json({ ok: true, results });
}
