"use client";

import { useMemo, useState } from "react";
import { DocContent } from "../DocContent";
import { scrollToRev, setRevBusy, useRevisions, type Rev } from "./revisions";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 渲染后的正文拆成顶层块（和服务端 splitBlocks 的顺序一致：元素和非空文字） */
function topBlocks(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out: string[] = [];
  doc.body.childNodes.forEach((n) => {
    if (n.nodeType === 1) out.push((n as Element).outerHTML);
    else if (n.nodeType === 3 && n.textContent?.trim()) out.push(esc(n.textContent));
  });
  return out;
}

function revHtml(r: Rev, original: string | null, disabled: boolean) {
  const label = r.op === "delete" ? "删除" : r.op === "insert_after" ? "新增" : "修改";
  const acts = disabled
    ? ""
    : `<span class="nv-rev-acts"><button type="button" class="btn-secondary nv-head-btn" data-act="ignore" data-rev="${r.id}">拒绝</button><button type="button" class="btn-primary nv-head-btn" data-act="apply" data-rev="${r.id}">接受</button></span>`;
  return (
    `<div class="nv-rev" id="rev-${r.id}" data-op="${r.op}">` +
    `<div class="nv-rev-head"><span class="nv-rev-no">修订 ${r.no}</span><span class="nv-rev-title">${label} · ${esc(r.title)}</span>${acts}</div>` +
    (original != null ? `<div class="nv-rev-del">${original}</div>` : "") +
    (r.op !== "delete" && r.html ? `<div class="nv-rev-ins">${r.html}</div>` : "") +
    `</div>`
  );
}

/** PRD 正文：有待确认的修改时按修订标记显示（删除红底删除线、新增绿底），逐处或全部接受 / 拒绝 */
export function DocRevisions({ pageId, html }: { pageId: string; html: string }) {
  const rv = useRevisions(pageId);
  const [cursor, setCursor] = useState(0);
  const busy = rv?.busy ?? null;

  const composed = useMemo(() => {
    if (!rv) return null;
    const ro = !!busy || !!rv.readOnly;
    const blocks = topBlocks(html);
    const at = new Map<number, Rev[]>();
    for (const r of rv.items) if (r.index >= 0 && r.index < blocks.length) at.set(r.index, [...(at.get(r.index) || []), r]);
    const parts: string[] = [];
    blocks.forEach((b, i) => {
      const list = at.get(i);
      if (!list) return parts.push(b);
      const change = list.find((r) => r.op === "replace" || r.op === "delete");
      if (change) parts.push(revHtml(change, b, ro));
      else parts.push(b);
      for (const r of list.filter((x) => x.op === "insert_after")) parts.push(revHtml(r, null, ro));
      // 同一块上的第二条替换 / 删除：原块已经标过一次，只显示新内容
      for (const r of list.filter((x) => x !== change && x.op !== "insert_after")) parts.push(revHtml(r, null, ro));
    });
    return parts.join("\n");
  }, [rv, html, busy]);

  if (!rv || !composed) return <DocContent html={html} />;
  const shown = rv.items.filter((r) => r.index >= 0);
  const run = async (list: Rev[], op: "apply" | "ignore") => {
    setRevBusy(list.length > 1 ? "all" : list[0].id);
    try {
      // 按消息分组：同一条消息里的全部用一次「全部应用 / 忽略」
      const byMsg = new Map<string, Rev[]>();
      for (const r of list) byMsg.set(r.messageId, [...(byMsg.get(r.messageId) || []), r]);
      for (const [mid, rs] of byMsg) {
        if (rs.length > 1) await rv.act(mid, "all", op);
        else await rv.act(mid, rs[0].id, op);
      }
    } finally {
      setRevBusy(null);
    }
  };
  const go = (d: number) => {
    if (!shown.length) return;
    const n = (cursor + d + shown.length) % shown.length;
    setCursor(n);
    scrollToRev(shown[n].id);
  };

  return (
    <>
      <div className="nv-rev-bar" role="region" aria-label="待确认的修改">
        <p>
          小围提出 <b>{shown.length}</b> 处修改，已标在正文里。{rv.readOnly ? "有编辑权限的人可以逐处接受或拒绝。" : "接受后发布为新的一版，可以在版本记录里恢复。"}
        </p>
        <div className="nv-rev-bar-acts">
          {shown.length > 1 ? (
            <>
              <button type="button" className="text-link" onClick={() => go(-1)}>
                上一处
              </button>
              <button type="button" className="text-link" onClick={() => go(1)}>
                下一处
              </button>
            </>
          ) : null}
          {rv.readOnly ? null : (
            <>
              <button type="button" className="btn-secondary nv-head-btn" disabled={!!busy} onClick={() => void run(shown, "ignore")}>
                全部拒绝
              </button>
              <button type="button" className="btn-primary nv-head-btn" disabled={!!busy} onClick={() => void run(shown, "apply")}>
                {busy === "all" ? "正在应用…" : `全部接受（${shown.length}）`}
              </button>
            </>
          )}
        </div>
      </div>
      <div
        onClick={(e) => {
          const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
          if (!b || busy) return;
          const r = rv.items.find((x) => x.id === b.dataset.rev);
          if (r) void run([r], b.dataset.act === "apply" ? "apply" : "ignore");
        }}
      >
        <DocContent html={composed} />
      </div>
    </>
  );
}
