import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** 旧的体验链接：已并入登录页的「邀请登录」 */
export default async function DemoLinkPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  redirect(`/login?invite=${encodeURIComponent(token)}`);
}
