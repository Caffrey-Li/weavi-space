import type { SessionUser } from "../auth";
import { result } from "./result";
import { feishuRedirectUri, feishuSettings } from "../shared/feishu-auth";
import { clearFeishu, getStoredFeishu, mask, saveFeishu } from "../shared/secure-config";

function isAdmin(session: SessionUser | null) {
  return session && session.globalRole === "admin" ? session : null;
}

/** 只返回掩码，App Secret 永不回传 */
async function view(req: Request) {
  const stored = await getStoredFeishu();
  const cfg = await feishuSettings();
  return {
    configured: Boolean(cfg),
    source: cfg?.source || null,
    appIdMasked: mask(cfg?.appId),
    secretSet: Boolean(cfg?.appSecret),
    redirectUri: stored?.redirectUri || "",
    autoCreate: cfg ? cfg.autoCreate : true,
    updatedAt: stored?.updatedAt || null,
    updatedBy: stored?.updatedBy || null,
    callbackUrl: feishuRedirectUri(req, cfg?.redirectUri),
  };
}

/** 用 App ID / Secret 换一次 tenant_access_token，确认凭据有效 */
async function verify(appId: string, appSecret: string) {
  try {
    const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { code?: number; msg?: string };
    return data.code === 0 ? null : `飞书校验未通过：${data.msg || `HTTP ${res.status}`}。请检查 App ID 和 App Secret。`;
  } catch {
    return "暂时连不上飞书服务器，凭据未保存，请稍后再试。";
  }
}

/** 未登录与非管理员一律 403（与原路由一致，不先回 401） */
export async function GET(session: SessionUser | null, req: Request) {
  if (!isAdmin(session)) return result({ error: "仅系统管理员可查看" }, { status: 403 });
  return result(await view(req));
}

export async function PUT(session: SessionUser | null, req: Request, body: Record<string, unknown>) {
  const s = isAdmin(session);
  if (!s) return result({ error: "仅系统管理员可修改" }, { status: 403 });
  const prev = await getStoredFeishu();
  const appId = String(body.appId || "").trim() || prev?.appId || "";
  const appSecret = String(body.appSecret || "").trim() || prev?.appSecret || "";
  const redirectUri = String(body.redirectUri || "").trim();
  if (!/^cli_[A-Za-z0-9]+$/.test(appId)) return result({ error: "App ID 格式不对，应以 cli_ 开头" }, { status: 400 });
  if (!appSecret) return result({ error: "请填写 App Secret" }, { status: 400 });
  if (redirectUri && !/^https?:\/\/[^\s]+\/api\/auth\/feishu\/callback$/.test(redirectUri)) {
    return result({ error: "回调地址应以 /api/auth/feishu/callback 结尾" }, { status: 400 });
  }
  const bad = await verify(appId, appSecret);
  if (bad) return result({ error: bad }, { status: 400 });
  await saveFeishu({ appId, appSecret, redirectUri, autoCreate: body.autoCreate !== false }, s.name);
  return result(await view(req));
}

export async function DELETE(session: SessionUser | null, req: Request) {
  if (!isAdmin(session)) return result({ error: "仅系统管理员可修改" }, { status: 403 });
  await clearFeishu();
  return result(await view(req));
}
