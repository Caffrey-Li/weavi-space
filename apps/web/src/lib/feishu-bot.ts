import { createHmac } from "crypto";
import { prisma } from "./prisma";
import { openText, sealText } from "./secure-config";
import { sendDirectCard } from "./feishu-api";

/**
 * 个人飞书 / Lark 机器人：两个渠道可同时开启
 * - 群自定义机器人 Webhook：地址和签名密钥 AES-GCM 加密存库，页面只显示掩码
 * - 飞书私信：用系统配置的企业自建应用，按用户飞书登录时记下的 open_id 私信
 */
export const BOT_EVENTS = [
  { key: "req_assigned", label: "指派给我的需求有变化", hint: "状态、标题、计划日期、负责人", default: true },
  { key: "bug_assigned", label: "我负责的 Bug 有变化", hint: "新指派、状态变化", default: true },
  { key: "req_mine", label: "我创建的需求状态变化", hint: "例如 开发中 → 测试中", default: true },
  { key: "project_new", label: "我所在项目有新需求或新 Bug", hint: "项目成员都会收到，消息可能较多", default: false },
  { key: "release", label: "上线计划状态变化", hint: "冻结、开始发布、已上线", default: true },
  { key: "table_sync", label: "云表格同步完成", hint: "我发起的拉取或回写结束后通知结果", default: true },
  { key: "project_report", label: "项目周报", hint: "我所在项目按设置的时间定时发送周报", default: true },
  { key: "agent_confirm", label: "小围等我确认", hint: "我的自动化规则触发的任务要新建、修改或评论时，确认之前不会执行", default: true },
] as const;
export type BotEvent = (typeof BOT_EVENTS)[number]["key"];
export const DEFAULT_EVENTS: BotEvent[] = BOT_EVENTS.filter((e) => e.default).map((e) => e.key);

export function siteUrl(path = "/") {
  const base = process.env.APP_URL || process.env.URL || `http://localhost:${process.env.PORT || 3100}`;
  return new URL(path, base).toString();
}

/** 只接受飞书 / Lark 官方的自定义机器人地址，防止被拿来请求任意网址 */
export function validWebhook(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" && (u.hostname === "open.feishu.cn" || u.hostname === "open.larksuite.com") && u.pathname.startsWith("/open-apis/bot/v2/hook/");
  } catch {
    return false;
  }
}

export function maskWebhook(url: string | null) {
  if (!url) return "";
  const i = url.lastIndexOf("/");
  const id = url.slice(i + 1);
  return `${url.slice(0, i + 1)}••••••${id.slice(-4)}`;
}

export type Card = Record<string, unknown>;
export function buildCard(o: { title: string; lines: string[]; url?: string; button?: string; tone?: "blue" | "green" | "orange" | "red" | "grey" }): Card {
  const elements: unknown[] = [{ tag: "div", text: { tag: "lark_md", content: o.lines.join("\n") || " " } }];
  if (o.url) elements.push({ tag: "action", actions: [{ tag: "button", text: { tag: "plain_text", content: o.button || "在小围空间中打开" }, type: "primary", url: o.url }] });
  return { config: { wide_screen_mode: true }, header: { title: { tag: "plain_text", content: o.title }, template: o.tone || "blue" }, elements };
}

export async function sendWebhook(url: string, secret: string | null, card: Card) {
  if (!validWebhook(url)) throw new Error("Webhook 地址不是飞书 / Lark 自定义机器人地址");
  const body: Record<string, unknown> = { msg_type: "interactive", card };
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    body.timestamp = timestamp;
    body.sign = createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
  }
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as { code?: number; StatusCode?: number; msg?: string; StatusMessage?: string };
  const code = data.code ?? data.StatusCode;
  if (!res.ok || (code !== undefined && code !== 0)) {
    const msg = data.msg || data.StatusMessage || String(res.status);
    if (code === 19021) throw new Error(`签名校验失败：请确认签名密钥和机器人设置一致（${msg}）`);
    if (code === 19024) throw new Error(`消息被关键词校验拦截：请在机器人安全设置里改用签名校验（${msg}）`);
    throw new Error(`群机器人返回错误：${msg}（${code ?? res.status}）`);
  }
}

export type BotRow = Awaited<ReturnType<typeof loadBot>>;
export async function loadBot(userId: string) {
  return prisma.userBot.findUnique({ where: { userId } });
}

export function botEvents(raw: string | null | undefined): BotEvent[] {
  try {
    const arr = JSON.parse(raw || "") as string[];
    if (Array.isArray(arr)) return arr.filter((k): k is BotEvent => BOT_EVENTS.some((e) => e.key === k));
  } catch {
    /* 没设置过：用默认 */
  }
  return DEFAULT_EVENTS;
}

export async function saveBot(
  userId: string,
  input: { webhookUrl?: string; secret?: string; clearSecret?: boolean; webhookOn?: boolean; dmOn?: boolean; events?: string[] },
) {
  const prev = await prisma.userBot.findUnique({ where: { userId } });
  const data: Record<string, unknown> = {};
  if (input.webhookUrl !== undefined) {
    const u = input.webhookUrl.trim();
    if (u && !validWebhook(u)) throw new Error("请填写飞书或 Lark 群自定义机器人的 Webhook 地址（https://open.feishu.cn/open-apis/bot/v2/hook/…）");
    if (u) data.webhookEnc = sealText(u);
    else if (input.webhookUrl === "" && !prev?.webhookEnc) data.webhookEnc = null;
  }
  if (input.secret) data.secretEnc = sealText(input.secret.trim());
  if (input.clearSecret) data.secretEnc = null;
  if (input.webhookOn !== undefined) data.webhookOn = input.webhookOn;
  if (input.dmOn !== undefined) data.dmOn = input.dmOn;
  if (input.events) data.events = JSON.stringify(input.events.filter((k) => BOT_EVENTS.some((e) => e.key === k)));
  if (prev) return prisma.userBot.update({ where: { userId }, data });
  return prisma.userBot.create({ data: { userId, events: JSON.stringify(DEFAULT_EVENTS), ...data } });
}

export type Channel = "webhook" | "dm" | "both";

/** 按用户开启的渠道发送；channel 限定只走某个渠道。返回每个渠道的结果，失败不抛出 */
export async function deliver(userId: string, card: Card, channel: Channel = "both") {
  const bot = await loadBot(userId);
  const results: { channel: "webhook" | "dm"; ok: boolean; error?: string }[] = [];
  if (!bot) return results;
  if (bot.webhookOn && channel !== "dm") {
    const url = openText(bot.webhookEnc);
    if (url) {
      try {
        await sendWebhook(url, openText(bot.secretEnc), card);
        results.push({ channel: "webhook", ok: true });
      } catch (e) {
        results.push({ channel: "webhook", ok: false, error: e instanceof Error ? e.message : "发送失败" });
      }
    }
  }
  if (bot.dmOn && channel !== "webhook") {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { feishuOpenId: true } });
    if (u?.feishuOpenId) {
      try {
        await sendDirectCard(u.feishuOpenId, card);
        results.push({ channel: "dm", ok: true });
      } catch (e) {
        results.push({ channel: "dm", ok: false, error: e instanceof Error ? e.message : "发送失败" });
      }
    } else results.push({ channel: "dm", ok: false, error: "账号还没有用飞书登录过，无法私信" });
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) await prisma.userBot.update({ where: { userId }, data: { lastError: failed.map((f) => f.error).join("；").slice(0, 500) } }).catch(() => {});
  return results;
}
