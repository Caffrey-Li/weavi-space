"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

/** 模型管理页里的「AI 生图」入口：图片生成用单独的接口，按企业配置；只有系统超管和企业超管看得到 */
export function AiImageEntry() {
  const id = useId();
  const [v, setV] = useState<{ configured: boolean; baseUrl: string; model: string; scopes: { id: string; name: string }[]; scope: string } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/system/ai-image", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && !d.error && setV(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!v) return null;
  const scopeName = v.scopes.find((s) => s.id === v.scope)?.name || "";
  return (
    <section className="nv-set-section" aria-labelledby={`${id}-h`}>
      <header>
        <h2 id={`${id}-h`}>AI 生图</h2>
        <p>项目背景图和图标的「AI 生成」用单独的图片生成接口（豆包 Seedream、OpenAI、智谱 CogView 等），按企业配置、按张核算费用，和上面的对话模型分开。</p>
      </header>
      <div className="nv-models-list">
      <div className="nv-models-item">
        <div className="nv-models-item-main">
          <b>{scopeName}</b>
          <span className="nv-set-hint" style={{ display: "block" }}>{v.configured ? `已配置 · ${v.model}` : "还没有配置，编辑项目时的「AI 生成」不可用"}</span>
        </div>
        <Link href="/system/ai-image" className="btn-secondary nv-head-btn">
          {v.configured ? "修改配置" : "去配置"}
        </Link>
      </div>
      </div>
    </section>
  );
}
