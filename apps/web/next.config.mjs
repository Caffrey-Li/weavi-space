import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
nextEnv.loadEnvConfig(root);

/**
 * 安全响应头。页面的 CSP 带每次请求的 nonce，在 src/middleware.ts 里设置；这里是不随请求变化的部分：
 * - HSTS：浏览器只走 HTTPS（只在生产环境发；只在 HTTPS 访问时生效）
 * - 接口和上传文件：不是页面，不需要加载任何资源，用最严的 CSP，直接打开文件时里面的脚本也不会执行
 * - 其余：禁止被嵌入、禁止 MIME 嗅探、收紧 Referer、关掉用不到的浏览器能力
 */
const isDev = process.env.NODE_ENV !== "production";

const securityHeaders = [
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const lockedDown = [{ key: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox" }];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 上级目录也有 lockfile，不固定的话 Next 会把工作区根目录认错
  outputFileTracingRoot: root,
  turbopack: { root },
  // 允许本地验收时用独立输出目录跑 dev（NEXT_DIST_DIR=.next-dev），不影响 3100 上的生产构建
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // 不暴露 X-Powered-By: Next.js
  poweredByHeader: false,
  // 需求交付的测试执行器在服务端启动浏览器，playwright-core 不能被打包
  serverExternalPackages: ["playwright-core"],
  experimental: {
    // 数据型应用：动态页不走浏览器端 30 秒缓存，新建 / 编辑后返回列表立即看到最新数据
    staleTimes: { dynamic: 0, static: 180 },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: lockedDown },
      { source: "/uploads/:path*", headers: lockedDown },
    ];
  },
};

export default nextConfig;
