import Link from "next/link";
import { BrandLogo } from "@/components/ui/BrandLogo";

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-canvas,#F5F5F7)] px-4">
      <div className="card w-full max-w-md p-8">
        <BrandLogo className="mb-6" />
        <h1 className="page-title">忘记密码</h1>
        <p className="mt-2 text-sm text-neutral-500">管理员看不到你的密码。忘记密码时，可以用已开通的验证码、飞书 / 企业微信 / 钉钉方式登录后设置新密码，或请管理员发送重置链接。</p>
        <div className="banner-info mt-6 text-sm" role="status">
          管理员在「成员管理」里点「重置密码」后，旧密码立即失效，系统生成 24 小时有效的重置链接，打开链接核对邮箱即可登录并设置新密码。
        </div>
        <Link href="/login" className="btn-primary mt-6 inline-flex w-full justify-center">
          返回登录
        </Link>
      </div>
    </div>
  );
}
