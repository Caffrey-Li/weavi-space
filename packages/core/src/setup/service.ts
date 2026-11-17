import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "@pm-collab/db/prisma";
import { hashPassword, type SessionUser } from "../auth";
import { passwordProblem } from "../shared/password-policy";
import { ensureSystemOrg } from "../shared/org";
import { saveSystemSettings } from "../shared/system-settings";
import { POST as createEnterprise } from "../nova/enterprises";
import { ADMIN_ROLE } from "../shared/roles-shared";

/**
 * 首次安装向导（/setup）：库里还没有启用的系统管理员时，服务启动会生成一次性安装码打印到日志，
 * 拿着安装码在向导里创建第一个超级管理员（自己设密码），之后向导永久关闭。
 * 安装码只存 sha256，24 小时有效，服务重启会重新生成；创建管理员后立即删除。
 */

const KEY = "setup_code";
export const SETUP_CODE_TTL_MS = 24 * 3600 * 1000;
// 去掉容易看错的 0/O、1/I/L
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** 用户输入的安装码统一成大写、去掉空格和横线 */
export const normalizeCode = (raw: unknown) => String(raw ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 16);

export function generateCode() {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

let closed = false; // 已有管理员后不会再回到「需要安装」，记住结果省一次查库

/** 是否还没有启用的系统管理员 */
export async function needsSetup() {
  if (closed) return false;
  const n = await prisma.user.count({ where: { globalRole: ADMIN_ROLE, isActive: true } });
  if (n > 0) closed = true;
  return n === 0;
}

/** 服务启动时调用：需要安装就生成新的安装码并打印到日志，返回安装码（不需要安装返回 null） */
export async function issueSetupCode(log: (msg: string) => void = console.log) {
  if (!(await needsSetup())) {
    await prisma.systemSetting.deleteMany({ where: { key: KEY } });
    return null;
  }
  const code = generateCode();
  const value = JSON.stringify({ hash: sha(normalizeCode(code)), expiresAt: Date.now() + SETUP_CODE_TTL_MS });
  await prisma.systemSetting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
  const site = (process.env.APP_URL || "").replace(/\/$/, "");
  log(`[安装向导] 系统还没有管理员。打开 ${site || "网站"}/setup，输入安装码：${code}（24 小时内有效，重启服务会重新生成）`);
  return code;
}

/** 安装码是否正确且未过期 */
export async function checkSetupCode(raw: unknown) {
  const code = normalizeCode(raw);
  if (code.length !== 8) return false;
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
  if (!row) return false;
  let saved: { hash?: string; expiresAt?: number };
  try {
    saved = JSON.parse(row.value);
  } catch {
    return false;
  }
  if (!saved.hash || !saved.expiresAt || saved.expiresAt < Date.now()) return false;
  const a = Buffer.from(sha(code)), b = Buffer.from(saved.hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type FirstAdminInput = { code: unknown; name: unknown; email: unknown; password: unknown };

/** 创建第一个超级管理员；成功返回 { userId }，失败返回 { error, status } */
export async function createFirstAdmin(input: FirstAdminInput): Promise<{ userId: string } | { error: string; status: number }> {
  const name = String(input.name ?? "").trim();
  const email = String(input.email ?? "").trim().toLowerCase();
  const password = String(input.password ?? "");
  if (!name || name.length > 40) return { error: "请填写姓名（最多 40 个字）", status: 400 };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { error: "请填写有效的邮箱", status: 400 };
  const problem = passwordProblem(password, email);
  if (problem) return { error: problem, status: 400 };
  if (!(await needsSetup())) return { error: "系统已经有管理员，安装向导已关闭", status: 404 };
  if (!(await checkSetupCode(input.code))) return { error: "安装码不对或已过期", status: 403 };
  await ensureSystemOrg();
  const passwordHash = await hashPassword(password);
  try {
    const userId = await prisma.$transaction(async (tx) => {
      // 同一时间只允许一个请求建管理员，两个人同时提交时后到的会失败
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(735102)`;
      const existing = await tx.user.count({ where: { globalRole: ADMIN_ROLE, isActive: true } });
      if (existing > 0) throw new Error("ALREADY");
      if (await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } })) throw new Error("EMAIL");
      const u = await tx.user.create({ data: { email, name, globalRole: ADMIN_ROLE, passwordHash, mustChangePassword: false }, select: { id: true } });
      await tx.systemSetting.deleteMany({ where: { key: KEY } });
      await tx.activityLog.create({ data: { entityType: "user", entityId: u.id, action: "setup_admin_created", actorId: u.id, toValue: JSON.stringify({ email }) } });
      return u.id;
    });
    closed = true;
    return { userId };
  } catch (e) {
    const m = (e as Error).message;
    if (m === "ALREADY") return { error: "系统已经有管理员，安装向导已关闭", status: 404 };
    if (m === "EMAIL") return { error: "这个邮箱已有账号，请换一个", status: 400 };
    throw e;
  }
}

/** 向导第 3 步：系统名称 + 第一个企业（都可选），只有系统超管能调 */
export async function saveBasics(session: SessionUser, body: Record<string, unknown>): Promise<{ ok: true; enterprise: { id: string; name: string; code: string | null } | null } | { error: string; status: number }> {
  if (session.globalRole !== ADMIN_ROLE) return { error: "只有系统超管可以操作", status: 403 };
  const systemName = String(body.systemName ?? "").trim();
  if (systemName.length > 30) return { error: "系统名称最多 30 个字", status: 400 };
  const entName = String(body.enterpriseName ?? "").trim();
  const entCode = String(body.enterpriseCode ?? "").trim();
  let enterprise: { id: string; name: string; code: string | null } | null = null;
  if (entName || entCode) {
    const res = await createEnterprise(session, { name: entName, code: entCode });
    const data = res.body as { error?: string; enterprise?: { id: string; name: string; code: string | null } };
    if (!data.enterprise) return { error: data.error || "企业创建失败", status: res.init?.status || 400 };
    enterprise = data.enterprise;
  }
  if (systemName) await saveSystemSettings({ name: systemName });
  // 勾选了「同时生成演示组织」：独立企业「示例科技」和全套演示数据（只动演示组织）
  if (body.demo === true) {
    const { buildDemo } = await import("../demo/service");
    const r = await buildDemo(session);
    if ("error" in r) return { error: r.error, status: r.status };
  }
  return { ok: true, enterprise };
}

/** 只给测试用 */
export function resetSetupStateForTest() {
  closed = false;
}
