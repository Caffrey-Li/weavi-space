"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, Box, ChevronsUpDown, Folder, Layers, List, Plus, SlidersHorizontal, UserRound, Users } from "lucide-react";
import { NavGroup } from "@/components/layout/NavGroup";
import { productStatus } from "@/lib/products";
import { ProductGlyph } from "./ProductGlyph";
import { ProductFormModal, type ProductFormValues } from "./ProductForm";

/** 产品增删改后通知侧栏刷新 */
export const PRODUCTS_CHANGED_EVENT = "pm-products-changed";
export function notifyProductsChanged() {
  window.dispatchEvent(new Event(PRODUCTS_CHANGED_EVENT));
}

type Detail = ProductFormValues & { id: string; counts: { nodes: number; requirements: number; projects: number } };
type Counts = { all: number; mine: number; joined: number; archived: number };
/** 服务端（app layout）给侧栏的产品数据：含已归档产品，侧栏列表只显示未归档的 */
export type ProductNavData = { counts: Counts; products: Detail[] };

/** 当前所在的产品（/products/<id>） */
export function productIdFromPath(pathname: string) {
  const m = pathname.match(/^\/products\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * 侧栏产品数据：首屏用服务端给的 initial（布局随 router.refresh 一起更新）；
 * 收到 PRODUCTS_CHANGED_EVENT 时再向接口要一次，作为兜底。
 */
function useProductNavData(initial?: ProductNavData, currentId?: string | null) {
  const [data, setData] = useState<ProductNavData | null>(initial ?? null);
  useEffect(() => {
    if (initial) setData(initial);
  }, [initial]);
  // 刚新建 / 刚从别处进入的产品可能还不在布局数据里：单独取一次详情补上
  const missing = Boolean(currentId && data && !data.products.some((p) => p.id === currentId));
  useEffect(() => {
    if (!missing || !currentId) return;
    let alive = true;
    fetch(`/api/products/${currentId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { product?: Detail } | null) => {
        if (!alive || !d?.product) return;
        const prod = d.product;
        setData((prev) =>
          prev && !prev.products.some((p) => p.id === prod.id)
            ? {
                counts: { ...prev.counts, all: prev.counts.all + (prod.status === "archived" ? 0 : 1) },
                products: [...prev.products, prod],
              }
            : prev,
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [missing, currentId]);
  /** 整体重取侧栏数据（产品增删改后触发） */
  const load = useCallback(async () => {
    const res = await fetch("/api/products/nav", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    setData((await res.json()) as ProductNavData);
  }, []);
  useEffect(() => {
    if (!initial) void load();
    window.addEventListener(PRODUCTS_CHANGED_EVENT, load);
    return () => window.removeEventListener(PRODUCTS_CHANGED_EVENT, load);
  }, [initial, load]);
  return data;
}

/** 侧栏顶部（Figma 27）：「← 全部产品」+ 产品切换卡（图标、名称、编码 · 状态、切换） */
export function ProductNavTop({ onNavigate, initial }: { onNavigate: () => void; initial?: ProductNavData }) {
  const pathname = usePathname();
  const id = productIdFromPath(pathname);
  const data = useProductNavData(initial, id);
  const detail = data?.products.find((p) => p.id === id);
  const products = data?.products.filter((p) => p.status !== "archived");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!id) return null;
  return (
    <div className="nv-pnav-top">
      <Link href="/products" className="nv-pnav-back" onClick={onNavigate}>
        <ArrowLeft size={14} aria-hidden="true" />
        全部产品
      </Link>
      <div ref={box} className="nv-pnav-switch-wrap">
        <button type="button" className="nv-pnav-switch" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <ProductGlyph code={detail?.code || ""} status={detail?.status} size={24} />
          <span className="nv-pnav-switch-text">
            <b>{detail?.name || "…"}</b>
            <small>{detail ? `${detail.code} · ${productStatus(detail.status).label}` : " "}</small>
          </span>
          <ChevronsUpDown size={14} aria-hidden="true" />
        </button>
        {open ? (
          <div role="menu" className="nv-menu nv-pnav-menu">
            {(products || []).map((p) => (
              <Link
                key={p.id}
                role="menuitem"
                href={`/products/${p.id}`}
                className="nv-menu-item"
                aria-current={p.id === id ? "page" : undefined}
                onClick={() => {
                  setOpen(false);
                  onNavigate();
                }}
              >
                <Layers size={14} aria-hidden="true" />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="nv-pnav-menu-code">{p.code}</span>
              </Link>
            ))}
            {products?.length === 0 ? <p className="nv-menu-label">没有其他产品</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 「产品」侧栏正文：列表页 = 视图（含计数）+「产品」分组；产品内 = 功能结构 / 关联需求 / 关联项目 / 产品信息 */
export function ProductNav({ onNavigate, canManage = false, initial }: { onNavigate: () => void; canManage?: boolean; initial?: ProductNavData }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const id = productIdFromPath(pathname);
  const data = useProductNavData(initial, id);
  const detail = data?.products.find((p) => p.id === id);
  const products = data ? data.products.filter((p) => p.status !== "archived") : null;
  const counts = data?.counts;
  const [editing, setEditing] = useState(false);
  const [fresh, setFresh] = useState<Detail | null>(null);
  /** 打开「产品信息」时取最新详情，避免拿侧栏里的旧数据覆盖别人刚改过的内容 */
  async function openEditor() {
    if (!id) return;
    const res = await fetch(`/api/products/${id}`, { cache: "no-store" }).catch(() => null);
    const d = res?.ok ? ((await res.json()) as { product?: Detail }) : null;
    setFresh(d?.product ?? detail ?? null);
    setEditing(true);
  }

  if (id) {
    const structActive = pathname === `/products/${id}` || pathname.startsWith(`/products/${id}/`);
    return (
      <div className="nv-nav-list">
        <Link href={`/products/${id}`} className={`nv-nav-item${structActive ? " is-active" : ""}`} aria-current={structActive ? "page" : undefined} onClick={onNavigate}>
          <Layers size={16} aria-hidden="true" />
          <span className="nv-nav-label">产品详情</span>
        </Link>
        <Link href={`/requirements?product=${id}`} className="nv-nav-item" onClick={onNavigate}>
          <List size={16} aria-hidden="true" />
          <span className="nv-nav-label">关联需求</span>
          <span className="nv-nav-num">{detail?.counts.requirements ?? ""}</span>
        </Link>
        {canManage ? (
          <>
            <button type="button" className="nv-nav-item" onClick={() => void openEditor()}>
              <Folder size={16} aria-hidden="true" />
              <span className="nv-nav-label">关联项目</span>
              <span className="nv-nav-num">{detail?.counts.projects ?? ""}</span>
            </button>
            <button type="button" className="nv-nav-item" onClick={() => void openEditor()}>
              <SlidersHorizontal size={16} aria-hidden="true" />
              <span className="nv-nav-label">产品信息</span>
            </button>
            {fresh ? (
              <ProductFormModal
                open={editing}
                productId={id}
                initial={{
                  name: fresh.name,
                  code: fresh.code,
                  description: fresh.description,
                  ownerId: fresh.ownerId,
                  status: fresh.status,
                  projectIds: fresh.projectIds,
                  environments: fresh.environments || [],
                }}
                onClose={() => setEditing(false)}
              />
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  const VIEWS = [
    { view: "", label: "全部产品", Icon: Box, count: counts?.all },
    { view: "mine", label: "我负责的", Icon: UserRound, count: counts?.mine },
    { view: "joined", label: "我参与的", Icon: Users, count: counts?.joined },
    { view: "archived", label: "已归档", Icon: Folder, count: counts?.archived },
  ];
  return (
    <>
      <div className="nv-nav-list">
        {VIEWS.map((v) => {
          const active = pathname === "/products" && (sp.get("view") || "") === v.view;
          return (
            <Link
              key={v.view}
              href={v.view ? `/products?view=${v.view}` : "/products"}
              className={`nv-nav-item${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
            >
              <v.Icon size={16} aria-hidden="true" />
              <span className="nv-nav-label">{v.label}</span>
              <span className="nv-nav-num">{v.count ?? ""}</span>
            </Link>
          );
        })}
      </div>
      <NavGroup
        id="products"
        label="产品"
        action={
          canManage ? (
            <Link href="/products?new=1" className="icon-button nv-nav-group-act" aria-label="新建产品" title="新建产品" onClick={onNavigate}>
              <Plus size={14} aria-hidden="true" />
            </Link>
          ) : undefined
        }
      >
        {products === null ? <p className="nv-sidebar-note">正在加载…</p> : null}
        {products?.map((p) => (
          <Link key={p.id} href={`/products/${p.id}`} className="nv-nav-item" onClick={onNavigate}>
            <Layers size={16} aria-hidden="true" />
            <span className="nv-nav-label">{p.name}</span>
          </Link>
        ))}
      </NavGroup>
    </>
  );
}
