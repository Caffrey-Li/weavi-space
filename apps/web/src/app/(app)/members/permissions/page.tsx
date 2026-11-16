import { redirect } from "next/navigation";

/** 旧路径兼容：原「成员」页内 Tab → 独立「角色权限」页 */
export default function MembersPermissionsRedirect() {
  redirect("/permissions");
}
