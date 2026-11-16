import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { openText } from "@/lib/secure-config";
import { BOT_EVENTS, botEvents, loadBot, maskWebhook, saveBot } from "@/lib/feishu-bot";
import { isFeishuConfigured } from "@/lib/feishu-auth";

export const dynamic = "force-dynamic";

/** 个人机器人设置：Webhook 只回掩码，签名密钥只回「是否已保存」 */
async function view(userId: string) {
  const [bot, me, appReady] = await Promise.all([loadBot(userId), prisma.user.findUnique({ where: { id: userId }, select: { name: true, feishuOpenId: true } }), isFeishuConfigured()]);
  return {
    webhookMasked: maskWebhook(openText(bot?.webhookEnc)),
    secretSet: Boolean(bot?.secretEnc),
    webhookOn: Boolean(bot?.webhookOn),
    dmOn: Boolean(bot?.dmOn),
    events: botEvents(bot?.events),
    eventOptions: BOT_EVENTS,
    lastTestAt: bot?.lastTestAt || null,
    lastTestOk: bot?.lastTestOk ?? null,
    lastError: bot?.lastError || null,
    feishuBound: Boolean(me?.feishuOpenId),
    name: me?.name || "",
    appReady,
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json(await view(session.id));
}

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { webhookUrl?: string; secret?: string; clearSecret?: boolean; webhookOn?: boolean; dmOn?: boolean; events?: string[] };
  try {
    await saveBot(session.id, body);
    return NextResponse.json(await view(session.id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "保存失败" }, { status: 400 });
  }
}
