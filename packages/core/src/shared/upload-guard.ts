/**
 * 上传校验：不相信浏览器报的 Content-Type 和文件名，按文件开头的魔数判断真实类型。
 * 不能引入 prisma。SVG 走 svg-sanitize.ts。
 */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export type ImageType = { mime: string; ext: string };

export function sniffImage(b: Uint8Array): ImageType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(b.subarray(from, to)));
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { mime: "image/png", ext: "png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return { mime: "image/gif", ext: "gif" };
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

/** 读取上传的图片并校验：返回真实类型和内容，不合格返回错误文案 */
export async function readImageUpload(file: File, opts: { max?: number; label?: string } = {}): Promise<{ data: Buffer; mime: string; ext: string } | { error: string }> {
  const max = opts.max ?? UPLOAD_MAX_BYTES;
  if (file.size > max) return { error: `${opts.label ?? "图片"}不能超过 ${Math.floor(max / 1024 / 1024)}MB` };
  const data = Buffer.from(await file.arrayBuffer());
  const type = sniffImage(data);
  if (!type) return { error: "仅支持 JPEG / PNG / WebP / GIF 格式" };
  return { data, ...type };
}

const ZIP_TYPES = new Set([
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const OLE_TYPES = new Set(["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"]);

/** 非图片附件：内容要和声明的类型对得上 */
export function fileMatchesType(mime: string, b: Uint8Array) {
  if (mime === "application/pdf") return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
  if (ZIP_TYPES.has(mime)) return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05);
  if (OLE_TYPES.has(mime)) return b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
  if (mime === "text/plain" || mime === "text/csv") return !b.subarray(0, 8192).includes(0); // 文本里没有 NUL
  return false;
}

/** 存库的显示名：去掉路径和控制字符 */
export function cleanFileName(name: string, fallback: string) {
  // eslint-disable-next-line no-control-regex
  const base = name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (base || fallback).slice(0, 200);
}
