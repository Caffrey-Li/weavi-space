import { requireProjectPage } from "@/lib/page-guard";
import { BugsView, type BugsSearch } from "@/components/views/BugsView";

export default async function ProjectBugsPage(
  props: { params: Promise<{ id: string }>; searchParams: Promise<BugsSearch> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  await requireProjectPage(params.id);
  return <BugsView searchParams={searchParams} projectId={params.id} />;
}
