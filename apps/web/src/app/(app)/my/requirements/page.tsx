import { PoolView, type PoolSearch } from "@/components/views/PoolView";

export default async function MyRequirementsPage(props: { searchParams: Promise<PoolSearch> }) {
  const searchParams = await props.searchParams;
  return <PoolView searchParams={searchParams} mine />;
}
