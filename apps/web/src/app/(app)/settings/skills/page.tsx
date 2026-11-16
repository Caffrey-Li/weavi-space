import { WorkHeader } from "@/components/layout/WorkHeader";
import { SkillsPanel } from "@/components/settings/SkillsPanel";

export const dynamic = "force-dynamic";

/** 设置 · 个人 · 个人能力：能力库（内置 + 我的 skill）/ API 令牌（T30） */
export default async function SkillsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === "tokens" ? "tokens" : "skills";
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "个人能力", icon: "sparkles" }]} />
      <div className="nv-page-body">
        <SkillsPanel tab={tab} />
      </div>
    </div>
  );
}
