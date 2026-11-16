import { BugsView, type BugsSearch } from "@/components/views/BugsView";

export default async function MyBugsPage(props: { searchParams: Promise<BugsSearch> }) {
  const searchParams = await props.searchParams;
  return <BugsView searchParams={searchParams} mine />;
}
