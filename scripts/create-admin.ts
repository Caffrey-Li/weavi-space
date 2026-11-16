/**
 * 新部署的第一个系统管理员：只在库里还没有任何启用的系统管理员时创建，已有就什么都不做（可以重复执行）。
 * 用法：INITIAL_ADMIN_EMAIL=admin@example.com [INITIAL_ADMIN_PASSWORD=…] npx tsx scripts/create-admin.ts
 * 没给密码时生成随机临时密码并只打印这一次；无论哪种，首次登录都必须修改密码。
 * Docker 镜像的启动脚本会在迁移之后调用它。
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@pm-collab/db/prisma";
import { hashPassword } from "@pm-collab/core/auth";
import { passwordProblem } from "@pm-collab/core/shared/password-policy";
import { ensureSystemOrg } from "@pm-collab/core/shared/org";

async function main() {
  const email = (process.env.INITIAL_ADMIN_EMAIL || "").trim().toLowerCase();
  if (!email) {
    console.log("[初始管理员] 没有设置 INITIAL_ADMIN_EMAIL，跳过");
    return;
  }
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error("INITIAL_ADMIN_EMAIL 不是有效的邮箱");
  const existing = await prisma.user.count({ where: { globalRole: "admin", isActive: true } });
  if (existing > 0) {
    console.log("[初始管理员] 已有系统管理员，跳过");
    return;
  }
  if (await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } })) {
    throw new Error("这个邮箱已有账号但不是启用的系统管理员，请换一个邮箱或手动处理");
  }
  const given = process.env.INITIAL_ADMIN_PASSWORD || "";
  const password = given || `Init-${randomBytes(9).toString("base64url")}7`;
  const problem = passwordProblem(password, email);
  if (problem) throw new Error(`INITIAL_ADMIN_PASSWORD 不合格：${problem}`);
  await ensureSystemOrg();
  await prisma.user.create({
    data: { email, name: "系统管理员", globalRole: "admin", passwordHash: await hashPassword(password), mustChangePassword: true },
  });
  if (given) console.log(`[初始管理员] 已创建 ${email}，使用 INITIAL_ADMIN_PASSWORD，首次登录须修改密码`);
  else console.log(`[初始管理员] 已创建 ${email}，临时密码（只显示这一次）：${password}，首次登录须修改密码`);
}

main()
  .catch((e) => {
    console.error("[初始管理员] 失败：", e instanceof Error ? e.message : "未知错误");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
