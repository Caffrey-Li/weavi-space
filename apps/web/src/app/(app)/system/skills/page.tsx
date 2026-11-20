import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { enterpriseAdminOf } from "@pm-collab/core/shared/enterprise-admin";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { EnterpriseSkillsPanel } from "@/components/settings/EnterpriseSkillsPanel";

export const dynamic = "force-dynamic";

/** 系统设置 · 企业 skill（T35）：给全企业统一配置 skill，定制内置的需求分析、PRD、测试用例、测试报告等 */
export default async function EnterpriseSkillsPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  if (session.globalRole !== "admin" && !(await enterpriseAdminOf(session.id))) redirect("/system/general");
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "企业 skill", icon: "sparkles" }]} />
      <div className="nv-page-body">
        <div className="nv-set nv-ftab">
          <header className="nv-set-title">
            <h1>企业 skill</h1>
            <p>给本企业所有人统一配置能力：可以新增企业自己的 skill，也可以定制内置的需求分析、PRD、测试用例、测试报告等（补充企业要求，或整份替换成企业模板）。成员在个人能力、需求交付、MCP 里用到的都会是定制后的版本。</p>
          </header>
          <EnterpriseSkillsPanel />
        </div>
      </div>
    </div>
  );
}
