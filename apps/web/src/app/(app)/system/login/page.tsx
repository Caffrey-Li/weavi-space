import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { adminGET } from "@pm-collab/core/login/service";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { LoginManagement } from "@/components/settings/LoginManagement";

export const dynamic = "force-dynamic";

/** 设置 · 登录管理：系统超管管系统级和各企业，企业超管管本企业；其他人按不存在处理 */
export default async function LoginManagementPage(props: { searchParams: Promise<{ scope?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  const { scope } = await props.searchParams;
  const r = await adminGET(session, scope ?? null);
  if (r.init?.status) notFound();
  const data = r.body as Parameters<typeof LoginManagement>[0]["initial"];
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "登录管理", icon: "key" }]} />
      <div className="nv-page-body">
        <LoginManagement initial={data} />
      </div>
    </div>
  );
}
