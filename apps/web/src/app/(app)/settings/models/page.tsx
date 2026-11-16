import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { settingsGET } from "@pm-collab/core/ai/credentials";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { ModelManagement } from "@/components/settings/ModelManagement";

export const dynamic = "force-dynamic";

/** 设置 · 个人 · 模型管理：自己的模型；企业超管另有企业模型和成员 token 定额 */
export default async function ModelsPage(props: { searchParams: Promise<{ enterprise?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  const { enterprise } = await props.searchParams;
  const r = await settingsGET(session, enterprise ?? null);
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "模型管理", icon: "sparkles" }]} />
      <div className="nv-page-body">
        <ModelManagement initial={r.body as Parameters<typeof ModelManagement>[0]["initial"]} />
      </div>
    </div>
  );
}
