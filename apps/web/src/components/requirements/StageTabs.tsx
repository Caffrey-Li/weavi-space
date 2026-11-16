import { REQ_STAGE_TABS } from "@/lib/constants";
import { RouteTabs } from "@/components/ui/RouteTabs";

/** 需求阶段切换：切换阶段时清掉具体状态和页码，避免「阶段 + 状态」互相矛盾。 */
export function StageTabs({
  basePath,
  stage,
  keep,
  counts,
}: {
  basePath: string;
  stage: string;
  keep: Record<string, string | undefined>;
  counts?: Record<string, number>;
}) {
  function href(key: string) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) sp.set(k, v);
    if (key) sp.set("stage", key);
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }
  return (
    <RouteTabs
      label="需求阶段"
      current={stage || ""}
      tabs={REQ_STAGE_TABS.map((t) => ({
        key: t.key,
        label: t.label,
        href: href(t.key),
        count: counts?.[t.key],
      }))}
    />
  );
}
