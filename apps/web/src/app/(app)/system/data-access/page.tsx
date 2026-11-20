import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { enterpriseAdminOf } from "@pm-collab/core/shared/enterprise-admin";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { DataAccessPanel } from "@/components/settings/DataAccessPanel";

export const dynamic = "force-dynamic";

/** 系统设置 · 数据开放（T34）：企业管理员控制成员通过 MCP / 开放接口取数 */
export default async function DataAccessPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  if (session.globalRole !== "admin" && !(await enterpriseAdminOf(session.id))) redirect("/system/general");
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "数据开放", icon: "plug" }]} />
      <div className="nv-page-body">
        <div className="nv-set nv-ftab">
          <header className="nv-set-title">
            <h1>数据开放</h1>
            <p>成员可以用个人 API 令牌通过 MCP（给 Claude、Cursor 等 Agent）或开放接口取数，权限和数据范围始终不超过本人。这里决定本企业是否允许、令牌最多能拿哪些范围，并查看每次调用记录。</p>
          </header>
          <DataAccessPanel />
        </div>
      </div>
    </div>
  );
}
