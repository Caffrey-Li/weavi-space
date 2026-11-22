import { reqCodeOf } from "@pm-collab/core/shared/codes";
import { notFound } from "next/navigation";
import { findProductForPage, canViewProductPage, canManageProductPage, loadProductIntro, loadProductArchitectures, loadProductTree } from "@pm-collab/core/products/detail-page-query";
import { getSession } from "@/lib/auth";
import { ProductTree, type NodeReq } from "@/components/products/ProductTree";
import { ProductIntro } from "@/components/products/ProductIntro";
import { ProductEnvs } from "@/components/products/ProductEnvs";
import { ProductArchGrid } from "@/components/products/ProductArchGrid";
import { ProductTabs, productTabFrom } from "@/components/products/ProductTabs";
import { parseEnvs } from "@/lib/product-envs";
import { loadProductProjects } from "@pm-collab/core/reports/service";
import { ProductProjects } from "@/components/products/ProductProjects";

/** 产品详情：顶部标签 产品介绍（Figma 60）/ 功能结构（27）/ 产品环境（61）/ 架构展示（62），当前标签在 ?tab= */
export default async function ProductDetailPage(
  props: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string | string[] }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const tab = productTabFrom(searchParams.tab);
  const product = await findProductForPage(params.id);
  if (!product) notFound();
  const session = await getSession();
  if (!session || !(await canViewProductPage(session, product.id))) notFound();
  const canManage = await canManageProductPage(session);

  if (tab === "intro") {
    const { intro, editor } = await loadProductIntro(product);
    return (
      <div className="nv-page-flush nv-pdetail">
        <ProductTabs productId={product.id} current={tab} />
        <ProductIntro productId={product.id} canManage={canManage} initial={{ html: intro?.html || "", updatedAt: intro?.updatedAt.toISOString() ?? null, updatedBy: editor?.name ?? null }} />
      </div>
    );
  }
  if (tab === "env") {
    return (
      <div className="nv-page-flush nv-pdetail">
        <ProductTabs productId={product.id} current={tab} />
        <ProductEnvs productId={product.id} canManage={canManage} initial={parseEnvs(product.environments)} />
      </div>
    );
  }
  if (tab === "projects") {
    const projects = await loadProductProjects(session, product.id);
    return (
      <div className="nv-page-flush nv-pdetail">
        <ProductTabs productId={product.id} current={tab} />
        <ProductProjects projects={projects} />
      </div>
    );
  }
  if (tab === "arch") {
    const items = await loadProductArchitectures(product);
    return (
      <div className="nv-page-flush nv-pdetail">
        <ProductTabs productId={product.id} current={tab} />
        <ProductArchGrid productId={product.id} canManage={canManage} items={items.map((a) => ({ ...a, updatedAt: a.updatedAt.toISOString() }))} />
      </div>
    );
  }

  const { counts, reqs, owners } = await loadProductTree(product);
  const countMap = new Map(counts.map((c) => [c.productNodeId, c._count]));
  const rows = product.nodes.map((n) => ({ ...n, reqCount: countMap.get(n.id) || 0 }));
  const reqsByNode: Record<string, NodeReq[]> = {};
  for (const r of reqs) {
    const list = (reqsByNode[r.productNodeId!] ||= []);
    if (list.length < 5) {
      list.push({ id: r.id, title: r.title, status: r.status, code: reqCodeOf(r) });
    }
  }

  return (
    <div className="nv-page-flush nv-pdetail">
      <ProductTabs productId={product.id} current={tab} />
      <ProductTree productId={product.id} productName={product.name} envs={parseEnvs(product.environments)} rows={rows} owners={owners} reqsByNode={reqsByNode} canManage={canManage} />
    </div>
  );
}
