import { demoLinkInfo } from "../demo/guests";
import { linkInfo } from "./service";

/**
 * 登录页「邀请登录」：成员邀请 / 重置链接和体验链接共用一个入口。
 * 链接都指向 /login?invite=<令牌>；也可以把整条链接或邀请码粘贴进来。旧地址 /invite/<令牌>、/demo/<令牌> 会跳到这里。
 */

/** 从粘贴的内容里取出令牌：整条链接（新旧两种地址都认）或单独的邀请码 */
export function inviteTokenFrom(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/[?&]invite=([A-Za-z0-9_-]+)/) || s.match(/\/(?:invite|demo)\/([A-Za-z0-9_-]+)/);
  const t = m ? m[1] : s;
  return /^[A-Za-z0-9_-]{16,100}$/.test(t) ? t : "";
}

export type InviteSummary =
  | { type: "demo"; name: string; kind: "readonly" | "editable"; position: string | null; orgName: string; expiresAt: string }
  | { type: "invite" | "reset"; userName: string; emailHint: string; enterprise: { name: string; code: string | null } | null; sso: { kind: string; label: string }[] };

/** 识别邀请：体验链接不需要再填账号；成员邀请 / 重置要核对账号邮箱或手机号 */
export async function inviteSummary(raw: string): Promise<InviteSummary | null> {
  const token = inviteTokenFrom(raw);
  if (!token) return null;
  const demo = await demoLinkInfo(token);
  if (demo) return { type: "demo", name: demo.name, kind: demo.kind, position: demo.position, orgName: demo.orgName, expiresAt: demo.expiresAt };
  const link = await linkInfo(token);
  if (link) return { type: link.purpose, userName: link.userName, emailHint: link.emailHint, enterprise: link.enterprise, sso: link.sso };
  return null;
}
