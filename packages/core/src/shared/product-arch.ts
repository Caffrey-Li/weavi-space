/** 架构图的类型与上传限制（客户端、服务端都可引用，不要在这里引入 prisma） */
export const ARCH_TYPES = [
  { key: "product", label: "产品架构图" },
  { key: "system", label: "系统架构图" },
  { key: "database", label: "数据库表结构图" },
  { key: "custom", label: "自定义" },
] as const;
export type ArchType = (typeof ARCH_TYPES)[number]["key"];

export function archTypeLabel(key: string) {
  return ARCH_TYPES.find((t) => t.key === key)?.label ?? "自定义";
}

export const ARCH_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
export const ARCH_IMAGE_ACCEPT = ARCH_IMAGE_TYPES.join(",");
export const ARCH_IMAGE_MAX = 5 * 1024 * 1024;

/** 上传前的检查，服务端同样校验；通过时返回空串 */
export function archImageProblem(file: { type: string; size: number }) {
  if (!ARCH_IMAGE_TYPES.includes(file.type.toLowerCase())) return "仅支持 PNG / JPG / SVG / WebP 图片";
  if (file.size > ARCH_IMAGE_MAX) return "图片不能超过 5MB";
  return "";
}
