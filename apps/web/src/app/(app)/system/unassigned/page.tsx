import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { UnassignedPanel } from "@/components/lifecycle/UnassignedPanel";

export const dynamic = "force-dynamic";

/** 设置 · 未归属需求（11-22）：把以前公共池里的需求 / Bug 分到项目；列表按本人数据范围，移动时逐条校验权限 */
export default async function UnassignedPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "未归属需求", icon: "trash" }]} />
      <div className="nv-page-body">
        <UnassignedPanel />
      </div>
    </div>
  );
}
