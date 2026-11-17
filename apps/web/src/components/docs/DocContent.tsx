"use client";

import { useEffect, useMemo, useRef } from "react";
import "katex/dist/katex.min.css";

/**
 * 文档正文（阅读态）：服务端已清洗的 HTML 原样输出，挂载后把两类代码块渲染出来：
 * - ```mermaid → 流程图 / 时序图 / 状态图（mermaid，securityLevel strict，黑白灰主题），失败就保留代码并提示；
 * - ```math → 公式（KaTeX，不信任输入、不执行命令）。
 * 原代码块留在页面里（隐藏），复制、打印都不丢原文。
 */
export function DocContent({ html, className = "doc-content" }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useMemo(() => ({ __html: html }), [html]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let alive = true;
    const blocks = (lang: string) => Array.from(root.querySelectorAll<HTMLElement>(`pre > code.language-${lang}`)).filter((c) => !c.parentElement!.dataset.rendered);

    const maths = blocks("math");
    if (maths.length) {
      void import("katex").then((katex) => {
        if (!alive) return;
        for (const code of maths) {
          const pre = code.parentElement!;
          const box = document.createElement("div");
          box.className = "doc-math";
          try {
            box.innerHTML = katex.default.renderToString(code.textContent || "", { displayMode: true, throwOnError: false, trust: false, strict: "ignore" });
          } catch {
            continue;
          }
          pre.dataset.rendered = "1";
          pre.hidden = true;
          pre.before(box);
        }
      });
    }

    const charts = blocks("mermaid");
    if (charts.length) {
      void import("mermaid").then(async ({ default: mermaid }) => {
        if (!alive) return;
        const dark = document.documentElement.dataset.theme === "dark";
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral", fontFamily: "inherit", flowchart: { htmlLabels: false } });
        for (const [i, code] of charts.entries()) {
          const pre = code.parentElement!;
          const box = document.createElement("figure");
          box.className = "doc-mermaid";
          try {
            const { svg } = await mermaid.render(`doc-mermaid-${Date.now()}-${i}`, code.textContent || "");
            if (!alive) return;
            box.innerHTML = svg;
            pre.hidden = true;
          } catch {
            box.className = "doc-mermaid is-error";
            box.textContent = "这段流程图写法有误，下面是原文。";
          }
          pre.dataset.rendered = "1";
          pre.before(box);
        }
      });
    }
    return () => {
      alive = false;
    };
  }, [html]);

  return <div ref={ref} className={className} dangerouslySetInnerHTML={inner} />;
}
