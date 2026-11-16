/**
 * 救急：忘了超级管理员密码时，在服务器上生成 24 小时有效的重置链接（旧密码立即作废，已登录的会话下线）。
 * 用法（仓库根目录，读 .env）：
 *   npm run reset-admin                 列出系统超管账号
 *   npm run reset-admin -- 邮箱          给这个账号生成重置链接（停用的会顺带启用）
 * 链接地址用 APP_URL；没配时按 http://localhost:${PORT:-3000} 打印，换成你的域名再打开。
 */
import "dotenv/config";
import { prisma } from "@pm-collab/db/prisma";
import { issueReset } from "@pm-collab/core/login/links";

async function main() {
  const email = (process.argv[2] || "").trim().toLowerCase();
  if (!email) {
    const admins = await prisma.user.findMany({ where: { globalRole: "admin" }, select: { email: true, name: true, isActive: true }, orderBy: { createdAt: "asc" } });
    if (!admins.length) {
      console.log("库里还没有系统超管：重启服务后到日志里找安装码，打开 /setup 创建。");
      return;
    }
    console.log("系统超管账号：");
    for (const a of admins) console.log(`  ${a.email}  ${a.name}${a.isActive ? "" : "（已停用）"}`);
    console.log("\n给其中一个生成重置链接：npm run reset-admin -- <邮箱>");
    return;
  }
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, name: true, email: true, globalRole: true, isActive: true } });
  if (!user) throw new Error(`找不到账号 ${email}`);
  if (user.globalRole !== "admin") throw new Error(`${email} 不是系统超管。普通成员请让管理员在「成员管理」里重置。`);
  if (!user.isActive) await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
  const origin = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
  const { link } = await issueReset(user, user.id, new URL(origin).origin);
  console.log(`已为 ${user.name}（${user.email}）生成重置链接，24 小时内有效，用一次就作废：\n\n  ${link}\n\n打开后核对邮箱，再设置新密码。旧密码已经作废。`);
}

main()
  .catch((e) => {
    console.error("[重置超管] 失败：", e instanceof Error ? e.message : "未知错误");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
