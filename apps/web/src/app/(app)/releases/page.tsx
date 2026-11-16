import { redirect } from "next/navigation";
import { ReleasesView, type ReleasesSearch } from "@/components/views/ReleasesView";

/** 全局发版：全部项目。选了项目（含旧链接 ?project=）跳到项目内发版页 */
export default async function ReleasesPage(props: { searchParams: Promise<ReleasesSearch & { project?: string }> }) {
  const searchParams = await props.searchParams;
  const { project, ...rest } = searchParams;
  if (project) {
    const sp = new URLSearchParams(Object.entries(rest).filter(([, v]) => v) as [string, string][]);
    const qs = sp.toString();
    redirect(`/projects/${encodeURIComponent(project)}/releases${qs ? `?${qs}` : ""}`);
  }
  return <ReleasesView searchParams={rest} />;
}
