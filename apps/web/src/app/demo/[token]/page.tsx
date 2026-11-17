import Link from "next/link";
import { demoLinkInfo } from "@pm-collab/core/demo/guests";
import { jobRoleLabel } from "@/lib/constants";
import { fmtDate } from "@/lib/utils";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { DemoEnterButton } from "@/components/auth/DemoEnterButton";

export const dynamic = "force-dynamic";

/** 体验链接（公开页）：显示体验方式和有效期，点「进入体验」登录 */
export default async function DemoLinkPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const info = await demoLinkInfo(token);
  return (
    <div className="flex min-h-screen items-center justify-center bg-nv-bg-canvas px-4">
      <div className="card w-full max-w-md p-8">
        <BrandLogo className="mb-6" />
        {info ? (
          <>
            <h1 className="page-title">欢迎体验小围空间</h1>
            <p className="mt-2 text-sm text-nv-text-secondary">你收到的是「{info.name}」的体验链接。</p>
            <dl className="nv-demo-link-info">
              <div>
                <dt>方式</dt>
                <dd>{info.kind === "editable" ? "可编辑（演示数据，会定期重置）" : "只读（只能查看，不能新建或修改）"}</dd>
              </div>
              <div>
                <dt>身份</dt>
                <dd>
                  {info.kind === "editable" && info.position ? `${jobRoleLabel(info.position)} · ` : "访客 · "}
                  {info.orgName}
                </dd>
              </div>
              <div>
                <dt>有效期至</dt>
                <dd>{fmtDate(info.expiresAt)}</dd>
              </div>
            </dl>
            <DemoEnterButton token={token} />
          </>
        ) : (
          <>
            <h1 className="page-title">体验链接已失效</h1>
            <p className="mt-2 text-sm text-nv-text-secondary">这个体验链接无效、已过期或已被停用，请联系发给你的人重新获取。</p>
            <Link href="/login" className="btn-primary mt-6 inline-flex w-full justify-center">
              去登录
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
