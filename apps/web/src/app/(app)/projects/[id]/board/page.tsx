import { requireProjectPage } from "@/lib/page-guard";
import { BoardView } from "@/components/views/BoardView";

export default async function ProjectBoardPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ iteration?: string }> }) {
  const params = await props.params;
  const sp = await props.searchParams;
  await requireProjectPage(params.id);
  return <BoardView projectId={params.id} iteration={sp.iteration} />;
}
