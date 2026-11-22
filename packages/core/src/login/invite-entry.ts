import { demoLinkInfo } from "../demo/guests";
import { linkInfo } from "./service";
import { normalizeInviteCode } from "../shared/unbound-account";

/**
 * 登录页「邀请登录」：成员邀请 / 重置链接和体验链接共用一个入口。
 * 链接都指向 /login?invite=<令牌或邀请码>；也可以把整条链接或 8 位邀请码输进来。成员邀请凭邀请码直接登录，
 * 登录后设置密码并绑定邮箱或手机号（login/bind.ts）；重置链接仍要核对账号。旧地址 /invite/<令牌>、/demo/<令牌> 会跳到这里。
 */

/** 从粘贴的内容里取出令牌：整条链接（新旧两种地址都认）或单独的邀请码 */
export function inviteTokenFrom(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/[?&]invite=([A-Za-z0-9_-]+)/) || s.match(/\/(?:invite|demo)\/([A-Za-z0-9_-]+)/);
  const t = m ? m[1] : s;
  // 8 位邀请码：不分大小写、可带短横线；其余是 32 字节的链接令牌（区分大小写）
  const code = normalizeInviteCode(t);
  if (code) return code;
  return /^[A-Za-z0-9_-]{16,100}$/.test(t) ? t : "";
}

export type InviteSummary =
  | { type: "demo"; name: string; kind: "readonly" | "editable"; position: string | null; orgName: string; expiresAt: string }
  | { type: "invite" | "reset"; userName: string; emailHint: string; needAccount: boolean; enterprise: { name: string; code: string | null } | null; sso: { kind: string; label: string }[] };

/** 识别邀请：体验链接不需要再填账号；成员邀请 / 重置要核对账号邮箱或手机号 */
export async function inviteSummary(raw: string): Promise<InviteSummary | null> {
  const token = inviteTokenFrom(raw);
  if (!token) return null;
  const demo = await demoLinkInfo(token);
  if (demo) return { type: "demo", name: demo.name, kind: demo.kind, position: demo.position, orgName: demo.orgName, expiresAt: demo.expiresAt };
  const link = await linkInfo(token);
  // 邀请（邀请码或旧邀请链接）凭码直接登录；重置链接仍要核对账号
  if (link) return { type: link.purpose, userName: link.userName, emailHint: link.emailHint, needAccount: link.purpose === "reset", enterprise: link.enterprise, sso: link.sso };
  return null;
}
