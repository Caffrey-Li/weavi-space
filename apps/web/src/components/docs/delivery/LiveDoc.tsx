"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { DocContent } from "../DocContent";
import { useLiveDoc } from "./revisions";

type LiveData = { active: boolean; title?: string; chars?: number; thinkChars?: number; count?: number; html?: string; thinkHtml?: string; startedAt?: string; ageMs?: number };

const WHAT: Record<string, string> = { prd: "PRD", cases: "测试用例", report: "测试报告", prototype: "原型", review: "AI 评审" };
const n = (v: number) => v.toLocaleString("zh-CN");
const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
};

function topBlocks(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out: string[] = [];
  doc.body.childNodes.forEach((x) => {
    if (x.nodeType === 1) out.push((x as Element).outerHTML);
    else if (x.nodeType === 3 && x.textContent?.trim()) out.push(x.textContent.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!));
  });
  return out;
}

/** 写完的块：内容不变就不重新渲染（流程图、公式只渲染一次） */
const DoneBlock = memo(function DoneBlock({ html }: { html: string }) {
  return <DocContent html={html} className="doc-content nv-live-block nv-live-in" />;
});

/** 生成中的文档：按 Wiki 渲染，逐段出现；正在写的最后一块不渲染流程图（还没写完） */
function LiveDoc({ deliveryId, what, title }: { deliveryId: string; what: string; title: string }) {
  const [data, setData] = useState<LiveData | null>(null);
  const [follow, setFollow] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const tick = async () => {
      try {
        const r = await fetch(`/api/deliveries/${deliveryId}/live?what=${what}`, { cache: "no-store" });
        const j = (await r.json()) as LiveData;
        if (alive && r.ok) setData((prev) => (j.active ? j : prev ? { ...prev, active: false } : j));
      } catch {
        /* 网络抖动：下次再取 */
      }
      if (alive) {
        setNow(Date.now());
        timer = window.setTimeout(() => void tick(), 1200);
      }
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [deliveryId, what]);

  const html = data?.html || "";
  const blocks = useMemo(() => (html ? topBlocks(html) : []), [html]);
  // 推理模型先思考：正文还没开始时显示思考里的草稿（只显示最后几段）
  const thinkHtml = !html && data?.thinkHtml ? data.thinkHtml : "";
  const draftBlocks = useMemo(() => (thinkHtml ? topBlocks(thinkHtml).slice(-14) : []), [thinkHtml]);

  // 跟随输出：内容变长就滚到底；用户往上翻就停止跟随
  useEffect(() => {
    const box = root.current?.closest(".nv-dl-main") as HTMLElement | null;
    if (!box) return;
    const onScroll = () => {
      const gap = box.scrollHeight - box.scrollTop - box.clientHeight;
      if (gap > 120) setFollow(false);
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!follow) return;
    const box = root.current?.closest(".nv-dl-main") as HTMLElement | null;
    if (box) box.scrollTop = box.scrollHeight;
  }, [blocks.length, data?.chars, data?.thinkChars, follow]);

  const elapsed = data?.startedAt && now ? now - new Date(data.startedAt).getTime() : 0;
  const writing = !!data?.active;
  const label = WHAT[what] || "文档";
  const status = !data || (!data.chars && writing)
    ? data?.thinkChars
      ? `小围正在构思${label} · 已想了 ${n(data.thinkChars)} 字${elapsed ? ` · 用时 ${dur(elapsed)}` : ""}`
      : `小围正在准备${label}…`
    : writing
      ? `小围正在写${label} · 已写 ${n(data.chars || 0)} 字${what === "cases" && data.count ? ` · ${data.count} 条用例` : ""}${elapsed ? ` · 用时 ${dur(elapsed)}` : ""}`
      : `${label}已写完，正在保存…`;
  const last = blocks.length - 1;

  return (
    <div className="doc-read-layout nv-live" ref={root}>
      <article className="doc-article">
        <div className="nv-live-bar" role="status" aria-live="polite">
          <span className="nv-live-status">
            {writing || !data ? <span className="nv-live-dot" aria-hidden="true" /> : <Loader2 size={12} className="nv-spin" aria-hidden="true" />}
            {status}
          </span>
          <button type="button" className="text-link" aria-pressed={follow} onClick={() => setFollow((v) => !v)}>
            {follow ? "跟随输出 ✓" : "跟随输出"}
          </button>
        </div>
        <h1 className="doc-title">{data?.title || title}</h1>
        <p className="doc-byline-sub nv-live-sub">{what === "prototype" ? "生成中，写完后挂到需求的「原型」资料上。" : `生成中，写完后自动打开${label}页。`}右侧可以看小围的思考，也可以随时停止。</p>
        {what === "prototype" && (data?.chars || 0) > 0 ? (
          <div className="nv-live-proto">
            <iframe key={Math.floor(now / 3000)} src={`/api/deliveries/${deliveryId}/prototype?v=live&t=${Math.floor(now / 3000)}`} title="原型实时预览" sandbox="allow-scripts" />
            <p className="nv-dl-hint is-small">原型边写边刷新（约 3 秒一次）；写完后在「原型设计」里可以打开完整预览。</p>
          </div>
        ) : blocks.length ? (
          <div className="nv-live-body">
            {blocks.map((b, i) =>
              i === last && writing ? (
                <div key={`w${i}`} className="doc-content nv-live-block is-writing nv-live-in" dangerouslySetInnerHTML={{ __html: b }} />
              ) : (
                <DoneBlock key={`${i}:${b.length}`} html={b} />
              ),
            )}
            {writing ? <span className="nv-dl-caret nv-live-caret" aria-hidden="true">▍</span> : null}
          </div>
        ) : draftBlocks.length ? (
          <div className="nv-live-draft" aria-label="构思草稿">
            <p className="nv-live-draft-tag">
              <span className="nv-live-bounce" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              构思草稿 · 模型还在思考，下面是它正在打的草稿，正式内容写出来后会替换掉
            </p>
            {draftBlocks.map((b, i) => (
              <div key={`d${i}:${b.length}`} className="doc-content nv-live-block nv-live-in" dangerouslySetInnerHTML={{ __html: b }} />
            ))}
            <span className="nv-dl-caret nv-live-caret" aria-hidden="true">▍</span>
          </div>
        ) : (
          <div className="nv-live-skeleton" aria-label={data?.chars ? "正在整理" : "等模型开始输出"}>
            <p className="nv-live-empty">
              <span className="nv-live-bounce" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {data?.chars ? "正在整理…" : "等模型开始输出…"}
            </p>
            {[92, 78, 85, 60, 88, 70].map((w, i) => (
              <span key={i} className="nv-live-sk" style={{ width: `${w}%`, animationDelay: `${i * 0.12}s` }} />
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

/** 文档区：有生成中的内容就实时显示，否则显示原来的正文 */
export function LiveDocSwitch({ pageId, children }: { pageId: string; children: React.ReactNode }) {
  const live = useLiveDoc(pageId);
  if (!live) return <>{children}</>;
  return <LiveDoc key={`${live.deliveryId}:${live.what}`} deliveryId={live.deliveryId} what={live.what} title={live.title} />;
}
