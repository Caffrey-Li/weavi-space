import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadNovaDemoPage } from "@pm-collab/core/nova/page-query";
import { NovaDemo } from "@/components/nova/NovaDemo";

export const dynamic = "force-dynamic";

/** Weavi Space 系统后台 · 演示体验：演示组织生成 / 重置、登录页一键体验、体验账号（只有系统超管；其他人按不存在处理） */
export default async function NovaDemoPage() {
  const data = await loadNovaDemoPage(await getSession());
  if (!data) notFound();
  return <NovaDemo {...data} />;
}
