import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores([".next*/**", "apps/web/.next*/**", ".netlify/**", "tmp/**", "screenshots/**", "public/**", "website/dist/**", "website/assets/vendor/**", "next-env.d.ts"]),
  ...nextCoreWebVitals,
  ...nextTypescript,
  // Next 应用在 apps/web（T4-F 起），告诉 @next/next 规则去哪找 pages / app 目录
  { settings: { next: { rootDir: "apps/web/" } } },
  // Next 16 新带的 React Compiler 规则。现有代码写于这些规则之前，项目也没开 React Compiler，
  // 全部改写风险大于收益，先作为警告保留，新代码尽量遵守
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
    },
  },
]);
