/**
 * Excalidraw 在模块加载时就读取字体地址，必须在 import("@excalidraw/excalidraw") 之前设好；
 * 字体由 scripts/copy-excalidraw-assets.mjs 在构建前复制到本站，不访问外部 CDN（CSP 也只允许本站字体）。
 */
if (typeof window !== "undefined") (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = `${window.location.origin}/excalidraw-assets/`;
export {};
