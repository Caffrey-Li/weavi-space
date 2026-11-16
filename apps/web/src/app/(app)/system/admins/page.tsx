import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadNovaAdminsPage } from "@pm-collab/core/nova/page-query";
import { NovaAdmins } from "@/components/nova/NovaAdmins";

export const dynamic = "force-dynamic";

/** Weavi Space 系统后台 · 系统超管账号（只有系统超管；其他人按不存在处理） */
export default async function NovaAdminsPage() {
  const data = await loadNovaAdminsPage(await getSession());
  if (!data) notFound();
  return <NovaAdmins admins={data.admins} />;
}
