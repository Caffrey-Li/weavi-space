import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadBoardSummary } from "@pm-collab/core/requirements/board-summary-query";
import { PageContext } from "@/components/layout/PageContext";
import { ProjectsSummaryBoard } from "@/components/board/ProjectsSummaryBoard";

export const dynamic = "force-dynamic";

/** 全局看板：按项目汇总数量（明细在项目内的「项目看板」）。带 project 参数的旧链接跳到项目看板 */
export default async function BoardPage(props: { searchParams: Promise<{ project?: string }> }) {
  const searchParams = await props.searchParams;
  if (searchParams.project) redirect(`/projects/${encodeURIComponent(searchParams.project)}/board`);
  const { rows } = await loadBoardSummary(await getSession());
  return (
    <>
      <PageContext crumbs={[{ label: "看板" }]} />
      <ProjectsSummaryBoard rows={rows} />
    </>
  );
}
