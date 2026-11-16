import { Layers } from "lucide-react";
import { productTone } from "@/lib/products";
import { projectTone } from "@/lib/project-tone";

/** 产品图标（Figma 26/27）：代表色 14% 浅底 + 同色 Layers 图标，圆角 sm */
export function ProductGlyph({ code, status, size = 28 }: { code: string; status?: string; size?: number }) {
  const tone = productTone(code, status);
  return (
    <span
      className="nv-prod-glyph"
      aria-hidden="true"
      style={{ width: size, height: size, color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}
    >
      <Layers size={Math.round(size * 0.57)} />
    </span>
  );
}

/** 浅色项目字母方块（Figma 26 关联项目列）：18 方块，代表色 16% 浅底 + 深色字母 */
export function SoftProjectIcon({ name, src, size = 18 }: { name: string; src?: string | null; size?: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" title={name} width={size} height={size} className="nv-soft-pico" style={{ width: size, height: size }} />;
  }
  const tone = projectTone(name);
  return (
    <span
      className="nv-soft-pico"
      title={name}
      style={{ width: size, height: size, color: `color-mix(in srgb, ${tone} 82%, black)`, background: `color-mix(in srgb, ${tone} 16%, transparent)` }}
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}
