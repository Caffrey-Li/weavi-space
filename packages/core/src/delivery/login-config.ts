import { openText, sealText } from "../shared/secure-config";

/**
 * T55 测试执行的自动登录：用例前置条件里写了登录（且不是「未登录」）时，执行器先按这里的步骤登录再跑用例；
 * accounts 按顺序匹配前置条件里的关键词（先匹配上的先用），都不匹配用默认测试账号。密码只存密文。
 */
export type LoginAccount = { match: string; username: string; passEnc: string | null };
export type LoginConfig = { path: string; user: string; pass: string; submit: string; accounts: LoginAccount[] };
export const LOGIN_DEFAULT = { path: "/login", user: "label=手机号", pass: "label=密码", submit: "role=button[name=登录]" };

const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export function parseLoginConfig(raw: unknown): LoginConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const path = str(r.path, 300);
  if (!path) return null;
  const accounts = (Array.isArray(r.accounts) ? r.accounts : [])
    .map((a) => a as Record<string, unknown>)
    .map((a) => ({ match: str(a.match, 60), username: str(a.username, 100), passEnc: typeof a.passEnc === "string" ? a.passEnc : null }))
    .filter((a) => a.match && a.username)
    .slice(0, 20);
  return { path, user: str(r.user, 200) || LOGIN_DEFAULT.user, pass: str(r.pass, 200) || LOGIN_DEFAULT.pass, submit: str(r.submit, 200) || LOGIN_DEFAULT.submit, accounts };
}

/** 保存：{ enabled, path, user, pass, submit, accounts: [{ match, username, password?, keepPass? }] }；密码留空 = 沿用原来的 */
export function cleanLoginInput(body: unknown, before: LoginConfig | null): LoginConfig | null {
  if (!body || typeof body !== "object") return before;
  const b = body as Record<string, unknown>;
  if (b.enabled === false) return null;
  const path = str(b.path, 300) || LOGIN_DEFAULT.path;
  if (!path.startsWith("/")) throw new Error("登录页路径要以 / 开头");
  const accounts: LoginAccount[] = [];
  for (const a of (Array.isArray(b.accounts) ? b.accounts : []).slice(0, 20) as Record<string, unknown>[]) {
    const match = str(a.match, 60);
    const username = str(a.username, 100);
    if (!match && !username) continue;
    if (!match || !username) throw new Error("换账号的每一行都要填关键词和账号");
    const pw = typeof a.password === "string" ? a.password.slice(0, 200) : "";
    const old = before?.accounts.find((x) => x.username === username)?.passEnc ?? null;
    accounts.push({ match, username, passEnc: pw ? sealText(pw) : old });
  }
  return { path, user: str(b.user, 200) || LOGIN_DEFAULT.user, pass: str(b.pass, 200) || LOGIN_DEFAULT.pass, submit: str(b.submit, 200) || LOGIN_DEFAULT.submit, accounts };
}

/** 这条用例要不要先登录：前置条件里有「登录」且不是「未登录」 */
export function needsLogin(precondition: string) {
  const p = precondition || "";
  return /登录|登陆/.test(p) && !/未登录|未登陆|退出登录/.test(p);
}

/** 按前置条件选账号：第一个关键词出现在前置条件里的；都不匹配用默认账号 */
export function pickAccount(cfg: LoginConfig | null, precondition: string, fallback: { username: string; password: string }) {
  const hit = cfg?.accounts.find((a) => (precondition || "").includes(a.match));
  return hit ? { username: hit.username, password: openText(hit.passEnc) || fallback.password, match: hit.match } : { ...fallback, match: null as string | null };
}

/** 给界面看的（不含密码） */
export function loginView(cfg: LoginConfig | null) {
  return cfg ? { path: cfg.path, user: cfg.user, pass: cfg.pass, submit: cfg.submit, accounts: cfg.accounts.map((a) => ({ match: a.match, username: a.username, hasPass: !!a.passEnc })) } : null;
}
