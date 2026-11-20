import { getSession } from "@/lib/auth";
import { RoleAdmin } from "@/components/members/RoleAdmin";
import { loadPermissionsPage } from "@pm-collab/core/permissions/page-query";

/** 角色权限（Figma 17）：角色 = 功能权限 + 数据范围 */
export default async function PermissionsPage() {
  const session = await getSession();
  const { canEdit, features, roles, createIn, enterprises, isSystemAdmin } = await loadPermissionsPage(session);
  return <RoleAdmin canEdit={canEdit} features={features} roles={roles} createIn={createIn} enterprises={enterprises} isSystemAdmin={isSystemAdmin} />;
}
