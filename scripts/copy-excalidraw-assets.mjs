// 构建前把 Excalidraw 的字体复制到 apps/web/public/excalidraw-assets/（不入库），画布从本站加载字体，不访问外部 CDN。
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const candidates = ["node_modules/@excalidraw/excalidraw", "apps/web/node_modules/@excalidraw/excalidraw"].map((p) => path.resolve(p));
const pkg = candidates.find((p) => existsSync(path.join(p, "package.json")));
if (!pkg) {
  console.warn("[excalidraw] 没有安装 @excalidraw/excalidraw，跳过字体复制");
  process.exit(0);
}
const src = path.join(pkg, "dist", "prod", "fonts");
const dest = path.resolve("apps/web/public/excalidraw-assets/fonts");
if (!existsSync(src)) {
  console.warn(`[excalidraw] 找不到 ${src}，跳过`);
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("[excalidraw] 字体已复制到 apps/web/public/excalidraw-assets/fonts");
