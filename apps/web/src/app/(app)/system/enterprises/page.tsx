import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadNovaEnterprisesPage } from "@pm-collab/core/nova/page-query";
import { NovaEnterprises } from "@/components/nova/NovaEnterprises";

export const dynamic = "force-dynamic";

/** Weavi Space 系统后台 · 企业管理（只有系统超管；其他人按不存在处理） */
export default async function NovaEnterprisesPage() {
  const data = await loadNovaEnterprisesPage(await getSession());
  if (!data) notFound();
  return <NovaEnterprises enterprises={data.enterprises} />;
}
