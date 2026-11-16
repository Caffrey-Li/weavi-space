import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "小围空间 · 把人、事和 AI 织在一起",
  description: "需求 · 看板 · 发版，一处看清交付",
};

/**
 * 外观偏好（设置 · 外观），首帧前写到 <html>，避免闪烁：
 * - 主题 pm-theme：light / dark / system → data-theme
 * - 风格 pm-style：weavi（小围，默认）/ classic（经典）→ data-style
 * - 画布（Excalidraw）字体从本站 /excalidraw-assets/ 加载：必须在它的模块执行前设好
 */
const THEME_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem("pm-theme")||"light";if(t==="system"){d.removeAttribute("data-theme")}else{d.setAttribute("data-theme",t==="dark"?"dark":"light")}d.setAttribute("data-style",localStorage.getItem("pm-style")==="classic"?"classic":"weavi")}catch(e){}window.EXCALIDRAW_ASSET_PATH=location.origin+"/excalidraw-assets/";`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 中间件为每个请求生成的 CSP nonce；Next 自己的脚本会自动带上，这里的内联脚本要手动给
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="zh-CN" data-theme="light" data-style="weavi" suppressHydrationWarning>
      <head>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
