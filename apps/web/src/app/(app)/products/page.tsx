import Link from "next/link";
import { parseEnvs } from "@/lib/product-envs";
import { Info } from "lucide-react";
import { canManageProducts, loadProductList } from "@pm-collab/core/products/list-page-query";
import { getSession } from "@/lib/auth";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { Avatar } from "@/components/ui/Avatar";
import { NewProductButton } from "@/components/products/ProductForm";
import { ProductRowMenu } from "@/components/products/ProductActions";
import { ProductFilters } from "@/components/products/ProductFilters";
import { ProductGlyph, SoftProjectIcon } from "@/components/products/ProductGlyph";
import { PRODUCT_STATUS, productStatus } from "@/lib/products";
import { fmtUpdated } from "@/lib/utils";

const VIEWS = { all: "全部产品", mine: "我负责的", joined: "我参与的", archived: "已归档" } as const;

type Search = { new?: string; view?: string; q?: string; owner?: string; status?: string };

/** 产品列表（Figma 26）：功能区（搜索、负责人、状态、新建产品）+ 表格（产品、负责人、功能结构、关联项目、需求、状态、更新时间、⋯）+ 底部提示 */
export default async function ProductsPage(props: { searchParams: Promise<Search> }) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  const canManage = await canManageProducts(session);
  const view: keyof typeof VIEWS = searchParams.view === "mine" || searchParams.view === "joined" || searchParams.view === "archived" ? searchParams.view : "all";
  const q = searchParams.q?.trim() || "";
  const status = PRODUCT_STATUS.some((s) => s.key === searchParams.status) ? searchParams.status! : "";
  const owner = searchParams.owner || "";
  const { products, allProducts, owners } = await loadProductList(session, { canManage, view, q, status, owner });
  const filtered = Boolean(q || status || owner);

  return (
    <div className="nv-page-flush nv-prod-page">
      <WorkHeader
        crumbs={[{ label: "产品", href: "/products", icon: "box" }, ...(view === "all" ? [] : [{ label: VIEWS[view] }])]}
        count={products.length}
        actions={
          <>
            <ProductFilters owners={owners} />
            {canManage ? <NewProductButton autoOpen={searchParams.new === "1"} products={allProducts} /> : null}
          </>
        }
      />
      <div className="nv-prod-scroll">
        {products.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">{filtered ? "没有符合条件的产品" : view === "archived" ? "没有已归档的产品" : view === "joined" ? "还没有参与的产品" : "还没有产品"}</p>
            <p>
              {canManage && view === "all" && !filtered
                ? "产品用来维护各个系统的名称和功能结构（菜单 › 功能模块 › 功能点），需求和 Bug 可以挂到具体的功能模块上。点右上角「新建产品」开始。"
                : "产品是需求、Bug 和发版的归属维度。"}
            </p>
            {filtered ? (
              <Link href={view === "all" ? "/products" : `/products?view=${view}`} className="btn-secondary nv-head-btn">
                清除筛选
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="nv-prod-table" role="table" aria-label="产品列表">
            <div className="nv-prod-row is-head" role="row">
              <span role="columnheader">产品</span>
              <span role="columnheader">负责人</span>
              <span role="columnheader">功能结构</span>
              <span role="columnheader">关联项目</span>
              <span role="columnheader">需求</span>
              <span role="columnheader">状态</span>
              <span role="columnheader">更新时间</span>
              <span role="columnheader" aria-label="操作" />
            </div>
            {products.map((p) => {
              const n = (t: string) => p.nodes.filter((x) => x.type === t).length;
              const st = productStatus(p.status);
              return (
                <div key={p.id} role="row" className="nv-prod-row">
                  <span role="cell" className="nv-prod-main">
                    <ProductGlyph code={p.code} status={p.status} />
                    <span className="min-w-0">
                      <span className="nv-prod-name-row">
                        <Link href={`/products/${p.id}`} className="nv-prod-name">
                          {p.name}
                        </Link>
                        <span className="nv-prod-code">{p.code}</span>
                      </span>
                      {p.description ? <span className="nv-prod-desc">{p.description}</span> : null}
                    </span>
                  </span>
                  <span role="cell" className="nv-prod-owner">
                    {p.owner ? (
                      <>
                        <Avatar name={p.owner.name} src={p.owner.avatarUrl} size={20} />
                        {p.owner.name}
                      </>
                    ) : (
                      <span className="nv-prod-muted">未指定</span>
                    )}
                  </span>
                  <span role="cell" className="nv-prod-struct">
                    <span>
                      <b>{n("menu")}</b>菜单
                    </span>
                    <span>
                      <b>{n("module")}</b>模块
                    </span>
                    <span>
                      <b>{n("feature")}</b>功能点
                    </span>
                  </span>
                  <span role="cell" className="nv-prod-projects-cell">
                    {p.projects.length ? (
                      <>
                        {p.projects.slice(0, 3).map((pr) => (
                          <SoftProjectIcon key={pr.id} name={pr.name} src={pr.iconUrl} />
                        ))}
                        <span className="nv-prod-sub">{p.projects.length} 个</span>
                      </>
                    ) : (
                      <span className="nv-prod-sub">—</span>
                    )}
                  </span>
                  <span role="cell" className="nv-prod-num">
                    {p._count.requirements}
                  </span>
                  <span role="cell">
                    <span className={`nv-tag ${st.tone || "is-neutral"}`}>
                      <i />
                      {st.label}
                    </span>
                  </span>
                  <span role="cell" className="nv-prod-time">
                    {fmtUpdated(p.updatedAt)}
                  </span>
                  <span role="cell" className="nv-prod-acts">
                    {canManage ? (
                      <ProductRowMenu
                        id={p.id}
                        name={p.name}
                        status={p.status}
                        linked={p._count.requirements}
                        initial={{ name: p.name, code: p.code, description: p.description || "", ownerId: p.ownerId || "", status: p.status, projectIds: p.projects.map((x) => x.id), environments: parseEnvs(p.environments) }}
                      />
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <p className="nv-prod-note">
          <Info size={14} aria-hidden="true" />
          产品是需求、Bug 和发版的归属维度。删除前需先解除关联项目；有历史需求的产品只能归档。
        </p>
      </div>
    </div>
  );
}
