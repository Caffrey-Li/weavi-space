import { requireProjectPage } from "@/lib/page-guard";
import { PoolView, type PoolSearch } from "@/components/views/PoolView";

export default async function ProjectRequirementsPoolPage(
  props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<PoolSearch>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  await requireProjectPage(params.id);
  return <PoolView searchParams={searchParams} projectId={params.id} />;
}
