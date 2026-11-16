/* eslint-disable @next/next/no-img-element */
/**
 * 产品品牌：小围空间 Weavi Space（T18）。
 * 图形：一条织毛线围脖围成圆环、尾巴扣成对勾，环里一点暖黄光代表 AI（素材在 public/brand/）。
 */
export const BRAND_NAME = "小围空间";
export const BRAND_SHORT = "小围";
export const BRAND_TAGLINE = "把人、事和 AI，织在一起";

/** 应用图标（圆角方形，自带暖橙渐变底） */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return <img src="/brand/icon-192.png" width={size} height={size} alt="" aria-hidden="true" className={className} style={{ borderRadius: Math.round(size * 0.24) }} />;
}

/** 放进已有底色的小方块里（全局栏、侧栏工作区卡片）：直接用应用图标铺满 */
export function BrandGlyph({ size = 14, className }: { size?: number; className?: string }) {
  return <img src="/brand/icon-64.png" width={size + 8} height={size + 8} alt="" aria-hidden="true" className={className} style={{ borderRadius: 4, margin: -4 }} />;
}

/** 横版标识（图形 + 「Weavi Space」字样）；tone="inverse" 时加浅色底，放在深色背景上 */
export function BrandLogo({ className = "", tone = "default", size = 36 }: { className?: string; tone?: "default" | "inverse"; size?: number }) {
  return (
    <div className={`flex items-center ${className}`} role="img" aria-label={`${BRAND_NAME} Weavi Space`}>
      <img src="/brand/logo.png" alt="" aria-hidden="true" style={{ height: size, width: "auto", ...(tone === "inverse" ? { background: "rgba(255,255,255,0.9)", borderRadius: 8, padding: "2px 8px" } : {}) }} />
    </div>
  );
}
