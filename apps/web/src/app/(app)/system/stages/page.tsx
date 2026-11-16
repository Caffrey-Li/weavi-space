import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { ReqStagesForm } from "@/components/settings/ReqStagesForm";

export const dynamic = "force-dynamic";

/** 设置 · 阶段管理（原「需求阶段」，Figma 52）：选择看板和各板块使用哪些阶段 */
export default async function ReqStagesPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "阶段管理", icon: "columns" }]} />
      <div className="nv-page-body">
        <ReqStagesForm />
      </div>
    </div>
  );
}
