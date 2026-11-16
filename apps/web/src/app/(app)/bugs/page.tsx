import { redirect } from "next/navigation";
import { BugsView, type BugsSearch } from "@/components/views/BugsView";

/** 全局 Bug：全部项目。选了项目（含旧链接 ?project=）跳到项目内 Bug 页，其余参数保留 */
export default async function BugsPage(props: { searchParams: Promise<BugsSearch & { project?: string }> }) {
  const searchParams = await props.searchParams;
  const { project, ...rest } = searchParams;
  if (project) {
    const sp = new URLSearchParams(Object.entries(rest).filter(([, v]) => v) as [string, string][]);
    const qs = sp.toString();
    redirect(`/projects/${encodeURIComponent(project)}/bugs${qs ? `?${qs}` : ""}`);
  }
  return <BugsView searchParams={rest} />;
}
