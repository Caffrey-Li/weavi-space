import Link from "next/link";
import { linkInfo } from "@pm-collab/core/login/service";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { InviteAcceptForm } from "@/components/auth/InviteAcceptForm";

export const dynamic = "force-dynamic";

/** 邀请 / 重置链接（公开页）：核对邮箱或手机号后登录，随后设置密码；也可用企业的飞书 / 企业微信 / 钉钉登录并绑定 */
export default async function InvitePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const info = await linkInfo(token);
  return (
    <div className="flex min-h-screen items-center justify-center bg-nv-bg-canvas px-4">
      <div className="card w-full max-w-md p-8">
        <BrandLogo className="mb-6" />
        {info ? (
          <>
            <h1 className="page-title">{info.purpose === "reset" ? "重置密码" : `加入${info.enterprise ? ` ${info.enterprise.name}` : " 小围空间"}`}</h1>
            <p className="mt-2 text-sm text-nv-text-secondary">
              {info.userName}，{info.purpose === "reset" ? "管理员已重置你的密码。" : "你被邀请加入小围空间。"}请填写账号邮箱 {info.emailHint}（或绑定的手机号）核对身份，登录后设置密码。
            </p>
            <InviteAcceptForm token={token} sso={info.sso} org={info.enterprise?.code || ""} />
          </>
        ) : (
          <>
            <h1 className="page-title">链接已失效</h1>
            <p className="mt-2 text-sm text-nv-text-secondary">链接无效、已被使用或已过期。请联系管理员重新发送邀请或重置链接。</p>
            <Link href="/login" className="btn-primary mt-6 inline-flex w-full justify-center">
              去登录
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
