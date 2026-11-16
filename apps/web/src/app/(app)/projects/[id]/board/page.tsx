import { requireProjectPage } from "@/lib/page-guard";
import { BoardView } from "@/components/views/BoardView";

export default async function ProjectBoardPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireProjectPage(params.id);
  return <BoardView projectId={params.id} />;
}
