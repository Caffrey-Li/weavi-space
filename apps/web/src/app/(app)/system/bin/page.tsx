import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { BinPanel } from "@/components/lifecycle/BinPanel";

export const dynamic = "force-dynamic";

/** 设置 · 归档与回收站（Figma 44）：产品、项目、需求、Bug、文档的已归档和回收站，统一在这里恢复 */
export default async function BinPage(props: { searchParams: Promise<{ tab?: string }> }) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "归档与回收站", icon: "trash" }]} />
      <div className="nv-page-body">
        <BinPanel initialTab={searchParams.tab === "trash" ? "trash" : "archived"} />
      </div>
    </div>
  );
}
