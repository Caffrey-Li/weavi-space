import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ArchDetail } from "@/components/products/ArchDetail";
import { ProductTabs } from "@/components/products/ProductTabs";
import { canViewProductPage } from "@pm-collab/core/products/detail-page-query";
import { findArchitectureForPage, loadArchitectureDetails } from "@pm-collab/core/products/architecture-page-query";
import { getSession } from "@/lib/auth";

/** 产品 · 架构图详情（Figma 63） */
export default async function ArchitecturePage(props: { params: Promise<{ id: string; archId: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) notFound();
  const arch = await findArchitectureForPage(params);
  if (!arch) notFound();
  if (!(await canViewProductPage(session, params.id))) notFound();
  const { canManage, editor } = await loadArchitectureDetails(session, arch);
  return (
    <div className="nv-page-flush nv-pdetail">
      <ProductTabs productId={params.id} current="arch" />
      <ArchDetail
        productId={params.id}
        canManage={canManage}
        arch={{ id: arch.id, type: arch.type, name: arch.name, description: arch.description || "" }}
        imageId={arch.imageId}
        meta={`${editor?.name || "—"} 更新于 ${format(arch.updatedAt, "yyyy-MM-dd HH:mm")}`}
      />
    </div>
  );
}
