import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { ReqStagesForm } from "@/components/settings/ReqStagesForm";
import { EnterpriseFlowForm } from "@/components/settings/EnterpriseFlowForm";

export const dynamic = "force-dynamic";

/** 设置 · 研发流程（原「阶段管理」，Figma 52 + T41）：企业流程（停用状态、显示名称、是否必须评审），系统超管另有系统默认阶段 */
export default async function ReqStagesPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "研发流程", icon: "columns" }]} />
      <div className="nv-page-body">
        <EnterpriseFlowForm />
        {session.globalRole === "admin" ? <ReqStagesForm /> : null}
      </div>
    </div>
  );
}
