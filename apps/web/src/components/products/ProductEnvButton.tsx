"use client";

import { useRef, useState } from "react";
import { ExternalLink, Link2 } from "lucide-react";
import { FloatingPop } from "@/components/ui/FloatingPop";
import type { ProductEnv } from "@/lib/product-envs";

/** 功能结构页头「环境地址」（Figma 27）：按环境分组列出地址，点开新窗口 */
export function ProductEnvButton({ envs }: { envs: ProductEnv[] }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const count = envs.reduce((n, e) => n + e.urls.length, 0);
  return (
    <>
      <button ref={ref} type="button" className="btn-secondary nv-head-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Link2 size={14} aria-hidden="true" />
        环境地址
      </button>
      <FloatingPop anchorRef={ref} open={open} onClose={() => setOpen(false)} width={320} className="nv-menu nv-env-pop" role="menu" label="环境地址">
        {envs.map((e) => (
          <div key={e.name} role="group" aria-label={e.name}>
            <p className="nv-env-pop-group">{e.name}</p>
            {e.urls.length ? (
              e.urls.map((u, i) => (
                <a key={i} role="menuitem" href={u.url} target="_blank" rel="noopener noreferrer" title={u.url} onClick={() => setOpen(false)}>
                  <ExternalLink size={12} aria-hidden="true" />
                  <span>{u.label}</span>
                  <span>{u.url.replace(/^https?:\/\//, "")}</span>
                </a>
              ))
            ) : (
              <p className="nv-env-pop-foot">还没有地址</p>
            )}
          </div>
        ))}
        <p className="nv-env-pop-foot">{count ? "在「产品环境」里维护环境和地址" : "还没有配置环境地址，在「产品环境」里添加"}</p>
      </FloatingPop>
    </>
  );
}
