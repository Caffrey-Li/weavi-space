import { redirect } from "next/navigation";
import { PoolView, type PoolSearch } from "@/components/views/PoolView";

/**
 * 全局需求池（全部项目）。选了具体项目（含旧链接 ?project=）跳到该项目需求池；
 * 「未归属项目」仍在这里筛选；旧的 ?mine=1 跳到「我的待办」。
 */
export default async function RequirementsPoolPage(props: { searchParams: Promise<PoolSearch & { mine?: string }> }) {
  const searchParams = await props.searchParams;
  const { project, mine, ...rest } = searchParams;
  const qs = () => {
    const sp = new URLSearchParams(Object.entries(rest).filter(([, v]) => v) as [string, string][]);
    const s = sp.toString();
    return s ? `?${s}` : "";
  };
  if (mine === "1") redirect(`/my/requirements${qs()}`);
  if (project && project !== "__none__") redirect(`/projects/${encodeURIComponent(project)}/requirements${qs()}`);
  return <PoolView searchParams={{ ...rest, project }} />;
}
