import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hashPassword, revokeUserSessions, startSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { passwordProblem } from "@/lib/password-policy";
import { accountLocked, clearFailures, clientIp, recordFailure } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";

const Body = z.object({ currentPassword: z.string().max(200).optional().default(""), newPassword: z.string().max(200) });

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    const currentPassword = parsed.data?.currentPassword ?? "";
    const newPassword = parsed.data?.newPassword ?? "";

    const user = await prisma.user.findUnique({ where: { id: session.id } });
    if (!user || !user.isActive) {
      return NextResponse.json({ error: "用户不存在或已停用" }, { status: 404 });
    }
    // 还没有密码（接受邀请或被管理员重置后，凭链接 / 第三方 / 验证码登录进来）：直接设置，不需要当前密码
    const firstSet = !user.passwordHash;
    if ((!firstSet && !currentPassword) || !newPassword) {
      return NextResponse.json({ error: "请填写当前密码和新密码" }, { status: 400 });
    }
    const problem = passwordProblem(newPassword, session.email);
    if (problem) {
      return NextResponse.json({ error: problem }, { status: 400 });
    }
    if (!firstSet && currentPassword === newPassword) {
      return NextResponse.json({ error: "新密码不能与当前密码相同" }, { status: 400 });
    }

    // 拿到别人的会话也不能靠这里反复猜当前密码
    const ip = clientIp(req.headers);
    const key = `change-password:${user.id}`;
    const wait = accountLocked(key, ip);
    if (wait) return NextResponse.json({ error: `尝试次数过多，请 ${Math.ceil(wait / 60)} 分钟后再试` }, { status: 429, headers: { "Retry-After": String(wait) } });

    const ok = firstSet || (await verifyPassword(currentPassword, user.passwordHash!));
    if (!ok) {
      recordFailure(key, ip);
      await securityLog("password_change_failed", user.email, ip, user.id);
      return NextResponse.json({ error: "当前密码不正确" }, { status: 400 });
    }
    clearFailures(key, ip);

    const passwordHash = await hashPassword(newPassword);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });

    // 所有设备（包括别人可能偷走的会话）全部下线，当前设备换一个新会话继续用
    await revokeUserSessions(user.id);
    await startSession(user.id, true);
    await securityLog("password_changed", user.email, ip, user.id);

    return NextResponse.json({
      ok: true,
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        globalRole: updated.globalRole,
        mustChangePassword: false,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "修改密码失败，请稍后重试" }, { status: 500 });
  }
}
