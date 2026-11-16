import { getSession } from "@/lib/auth";
import { UserAdmin } from "@/components/members/UserAdmin";
import { loadMembersPage } from "@pm-collab/core/members/page-query";

/** 成员管理（Figma 16 / 33）：所属组织、角色（权限）、岗位（职责）分列，支持批量调整 */
export default async function MembersUsersPage(props: { searchParams: Promise<{ new?: string; org?: string }> }) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  const data = await loadMembersPage(session, searchParams);
  return <UserAdmin {...data} />;
}
