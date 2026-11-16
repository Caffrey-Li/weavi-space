/** 密码规则（服务端和前端共用，不能引入 prisma） */

export const PASSWORD_HINT = "至少 10 位，同时包含字母和数字，不能是常见密码";

/** 种子数据 / 文档里出现过的默认密码和最常见的弱密码：生产环境用它们登录会被要求立即改密 */
const KNOWN_WEAK = new Set(
  [
    "admin123!",
    "admin123",
    "admin@123",
    "password",
    "password1",
    "password123",
    "12345678",
    "123456789",
    "1234567890",
    "qwerty123",
    "abc12345",
    "a123456789",
    "11111111",
    "88888888",
    "iloveyou",
    "welcome1",
  ].map((s) => s.toLowerCase()),
);

export function isKnownWeakPassword(pw: string) {
  return KNOWN_WEAK.has(pw.toLowerCase());
}

/** 返回不合格的原因；合格返回 null */
export function passwordProblem(pw: string, account?: string): string | null {
  if (pw.length < 10) return "密码至少 10 位";
  if (pw.length > 128) return "密码不能超过 128 位";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "密码需要同时包含字母和数字";
  if (isKnownWeakPassword(pw)) return "这是常见密码，请换一个";
  if (account) {
    const name = account.toLowerCase().split("@")[0];
    if (name.length >= 3 && pw.toLowerCase().includes(name)) return "密码不能包含账号名";
  }
  return null;
}
