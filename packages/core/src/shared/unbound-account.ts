/**
 * 邀请码邀请时可以不填邮箱：账号先用一个占位邮箱（保留域名 .invalid，永远收不到信、也不会和真实邮箱重名），
 * 本人用邀请码登录后自己绑定邮箱或手机号，绑定邮箱时替换掉占位邮箱。界面上占位邮箱一律显示「未绑定」。
 * 纯函数，客户端也引用。
 */
export const UNBOUND_EMAIL_DOMAIN = "unbound.invalid";

export function isUnboundEmail(email: string | null | undefined) {
  return Boolean(email && email.toLowerCase().endsWith(`@${UNBOUND_EMAIL_DOMAIN}`));
}

/** 界面显示用：占位邮箱显示「未绑定邮箱」 */
export function accountLabel(email: string | null | undefined) {
  return isUnboundEmail(email) ? "未绑定邮箱" : email || "";
}

/** 邀请码：8 位，去掉容易看错的 0 O 1 I L；显示成 K7QM-3XPA */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function normalizeInviteCode(raw: string) {
  const s = String(raw || "").replace(/[\s-]/g, "").toUpperCase();
  return s.length === 8 && [...s].every((c) => INVITE_CODE_ALPHABET.includes(c)) ? s : "";
}

export function formatInviteCode(code: string) {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
