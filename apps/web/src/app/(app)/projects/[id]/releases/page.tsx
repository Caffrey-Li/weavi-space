import { requireProjectPage } from "@/lib/page-guard";
import { ReleasesView, type ReleasesSearch } from "@/components/views/ReleasesView";

export default async function ProjectReleasesPage(
  props: { params: Promise<{ id: string }>; searchParams: Promise<ReleasesSearch> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  await requireProjectPage(params.id);
  return <ReleasesView searchParams={searchParams} projectId={params.id} />;
}
