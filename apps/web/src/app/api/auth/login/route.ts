import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, startSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { passwordProblem } from "@/lib/password-policy";
import { LOCK_MS, accountLocked, clearFailures, clientIp, hitIp, recordFailure } from "@/lib/rate-limit";
import { securityLog } from "@/lib/security-log";

const Body = z.object({
  account: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  password: z.string().max(200),
  remember: z.boolean().optional(),
});

function tooMany(seconds: number, message: string) {
  return NextResponse.json({ error: message }, { status: 429, headers: { "Retry-After": String(seconds) } });
}

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  try {
    const ipWait = hitIp(ip);
    if (ipWait) {
      await securityLog("login_ip_limited", "-", ip);
      return tooMany(ipWait, `登录尝试过于频繁，请 ${Math.ceil(ipWait / 60)} 分钟后再试`);
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    const account = (parsed.data?.account ?? parsed.data?.email ?? "").trim();
    const password = parsed.data?.password ?? "";
    if (!account || !password) return NextResponse.json({ error: "请输入账号和密码" }, { status: 400 });

    const key = account.toLowerCase();
    const lockWait = accountLocked(key, ip);
    if (lockWait) return tooMany(lockWait, `该账号连续登录失败次数过多，已临时锁定，请 ${Math.ceil(lockWait / 60)} 分钟后再试`);

    const user = await authenticate(account, password);
    if (!user) {
      const locked = recordFailure(key, ip);
      await securityLog(locked ? "login_locked" : "login_failed", key, ip);
      if (locked) return tooMany(LOCK_MS / 1000, "该账号连续登录失败次数过多，已临时锁定 15 分钟");
      return NextResponse.json({ error: "账号或密码错误" }, { status: 401 });
    }
    clearFailures(key, ip);

    // 生产环境：密码不符合规则（含种子数据的默认密码）的账号，登录后必须先改密码
    // 本地 HTML 预览用演示库的默认账号，脚本里设 ALLOW_DEFAULT_PASSWORDS=1 跳过
    const allowWeak = process.env.NODE_ENV !== "production" || process.env.ALLOW_DEFAULT_PASSWORDS === "1";
    if (!allowWeak && !user.mustChangePassword && passwordProblem(password)) {
      await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
      user.mustChangePassword = true;
      await securityLog("login_weak_password", key, ip, user.id);
    }

    await startSession(user.id, parsed.data?.remember === true);
    await securityLog("login_success", key, ip, user.id);
    return NextResponse.json({ ok: true, user });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "登录失败，请稍后重试" }, { status: 500 });
  }
}
