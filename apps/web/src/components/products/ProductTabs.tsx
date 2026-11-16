import { RouteTabs } from "@/components/ui/RouteTabs";

export const PRODUCT_TABS = [
  { key: "intro", label: "产品介绍" },
  { key: "structure", label: "功能结构" },
  { key: "env", label: "产品环境" },
  { key: "arch", label: "架构展示" },
  { key: "projects", label: "项目" },
] as const;
export type ProductTab = (typeof PRODUCT_TABS)[number]["key"];

export function productTabFrom(raw: string | string[] | undefined): ProductTab {
  return PRODUCT_TABS.find((t) => t.key === raw)?.key ?? "intro";
}

/** 产品详情顶部标签（Figma 60–63）：状态写在 URL 的 ?tab= 上，默认产品介绍 */
export function ProductTabs({ productId, current }: { productId: string; current: ProductTab }) {
  return (
    <div className="nv-ptabs">
      <RouteTabs label="产品详情" current={current} tabs={PRODUCT_TABS.map((t) => ({ ...t, href: t.key === "intro" ? `/products/${productId}` : `/products/${productId}?tab=${t.key}` }))} />
    </div>
  );
}
