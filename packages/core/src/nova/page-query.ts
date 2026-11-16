import type { SessionUser } from "../auth";
import { ADMIN_ROLE } from "../shared/roles-shared";
import { listEnterprises } from "./enterprises";
import { GET as listAdmins } from "./admins";

/** Weavi Space 系统后台页面数据；不是系统超管返回 null（页面 notFound） */
export async function loadNovaEnterprisesPage(session: SessionUser | null) {
  if (!session || session.globalRole !== ADMIN_ROLE) return null;
  return { enterprises: await listEnterprises() };
}

export async function loadNovaAdminsPage(session: SessionUser | null) {
  if (!session || session.globalRole !== ADMIN_ROLE) return null;
  const res = await listAdmins(session);
  return res.body as { admins: { id: string; name: string; email: string; isActive: boolean; createdAt: string; self: boolean }[] };
}
