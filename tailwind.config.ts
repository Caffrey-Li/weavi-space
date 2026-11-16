import type { Config } from "tailwindcss";
import path from "node:path";
import { existsSync } from "node:fs";
// Nova 2.0 预设：bg-nv-bg-surface、text-nv-text-secondary、rounded-nv-md、shadow-nv-md 等
// eslint-disable-next-line @typescript-eslint/no-require-imports
const novaPreset = require("./docs/design/nova/tokens/tailwind.preset.cjs");

const workspaceRoot = existsSync(path.join(process.cwd(), "apps/web/src")) ? process.cwd() : path.resolve(process.cwd(), "../..");

const config: Config = {
  presets: [novaPreset],
  content: [
    path.join(workspaceRoot, "apps/web/src/**/*.{js,ts,jsx,tsx,mdx}"),
    path.join(workspaceRoot, "packages/**/*.{js,ts,jsx,tsx,mdx}"),
  ],
  theme: {
    extend: {
      colors: {
        // 旧代码里的 neutral-* / brand-* 工具类指向 Nova 语义变量，浅色深色都正确
        brand: {
          50: "var(--nv-accent-subtle)",
          100: "var(--nv-accent-subtle)",
          200: "var(--nv-accent-subtle)",
          300: "var(--nv-blue-300)",
          400: "var(--nv-accent-hover)",
          500: "var(--nv-accent-default)",
          600: "var(--nv-text-link)",
          700: "var(--nv-accent-text)",
        },
        neutral: {
          25: "var(--nv-bg-surface)",
          50: "var(--nv-bg-subtle)",
          100: "var(--nv-border-subtle)",
          200: "var(--nv-border-default)",
          300: "var(--nv-border-strong)",
          400: "var(--nv-text-tertiary)",
          500: "var(--nv-text-secondary)",
          600: "var(--nv-text-secondary)",
          700: "var(--nv-text-primary)",
          800: "var(--nv-text-primary)",
          900: "var(--nv-text-primary)",
        },
      },
      fontFamily: {
        sans: ["var(--nv-font-sans)"],
        mono: ["var(--nv-font-mono)"],
      },
      borderRadius: {
        none: "var(--radius-0)",
        sm: "var(--nv-radius-xs)",
        DEFAULT: "var(--nv-radius-sm)",
        md: "var(--nv-radius-sm)",
        lg: "var(--nv-radius-md)",
        xl: "var(--nv-radius-lg)",
        "2xl": "var(--nv-radius-xl)",
        full: "var(--nv-radius-full)",
      },
      transitionDuration: {
        fast: "var(--nv-duration-fast)",
        DEFAULT: "var(--nv-duration-fast)",
        normal: "var(--nv-duration-base)",
        slow: "var(--nv-duration-slow)",
      },
      transitionTimingFunction: {
        standard: "var(--nv-ease-standard)",
        enter: "var(--nv-ease-enter)",
        exit: "var(--nv-ease-exit)",
        spring: "var(--nv-ease-spring)",
      },
    },
  },
  plugins: [],
};
export default config;
