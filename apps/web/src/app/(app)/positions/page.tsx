import { getSession } from "@/lib/auth";
import { PositionAdmin } from "@/components/members/PositionAdmin";
import { loadPositionsPage } from "@pm-collab/core/positions/page-query";

/** 岗位管理（Figma 32） */
export default async function PositionsPage() {
  const session = await getSession();
  const { canEdit, positions } = await loadPositionsPage(session);
  return <PositionAdmin canEdit={canEdit} positions={positions} />;
}
