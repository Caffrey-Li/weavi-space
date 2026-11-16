import { getSession } from "@/lib/auth";
import { PageContext } from "@/components/layout/PageContext";
import { OrgTree } from "@/components/orgs/OrgTree";
import { loadOrgsPage } from "@pm-collab/core/orgs/page-query";

/** 组织 · 组织架构（Figma 30）：Weavi Space › 企业 › 部门的树表 + 右侧编辑面板 */
export default async function OrgsPage() {
  const session = await getSession();
  const { orgs, members, canManage, isAdmin } = await loadOrgsPage(session);
  return (
    <div className="nv-page-flush">
      <PageContext crumbs={[{ label: "组织架构" }]} />
      <OrgTree orgs={orgs} members={members} canManage={canManage} isAdmin={isAdmin} />
    </div>
  );
}
