import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { enterpriseAdminOf } from "@pm-collab/core/shared/enterprise-admin";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { OrgSyncPanel } from "@/components/orgs/OrgSyncPanel";

export const dynamic = "force-dynamic";

/** 系统设置 · 飞书组织同步（T40） */
export default async function OrgSyncPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  if (session.globalRole !== "admin" && !(await enterpriseAdminOf(session.id))) redirect("/system/general");
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "飞书组织同步", icon: "network" }]} />
      <div className="nv-page-body">
        <div className="nv-set nv-ftab">
          <header className="nv-set-title">
            <h1>飞书组织同步</h1>
            <p>用本企业在「登录管理」里配置的飞书应用，把飞书通讯录的部门和成员同步过来：部门建到本企业下，成员按企业邮箱匹配并绑定飞书登录。先预览，确认后再同步；只改本企业的数据。</p>
          </header>
          <OrgSyncPanel />
        </div>
      </div>
    </div>
  );
}
