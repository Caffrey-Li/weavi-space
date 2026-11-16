"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkle } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import type { GenNode, GenResult, ApplyNode } from "@/lib/product-structure-gen";

const TYPE_TAG: Record<string, { label: string; tone: string }> = {
  menu: { label: "菜单", tone: "is-neutral" },
  module: { label: "模块", tone: "is-info" },
  feature: { label: "功能点", tone: "is-purple" },
};

/** 自动生成功能结构（Figma 45）：选来源 → 预览树（勾选）→ 只新增写入 */
export function StructureGenModal({ productId, productName, onClose, onDone }: { productId: string; productName: string; onClose: () => void; onDone: (created: number) => void }) {
  const [docs, setDocs] = useState(true);
  const [reqs, setReqs] = useState(true);
  const [result, setResult] = useState<GenResult | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(async (d: boolean, r: boolean) => {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/products/${productId}/structure-gen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docs: d, reqs: r }) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setLoading(false);
    if (!res?.ok) {
      setError((data as { error?: string }).error || "生成失败，请重试");
      return;
    }
    const g = data as GenResult;
    setResult(g);
    // 默认勾选所有新增节点
    const s = new Set<string>();
    const walk = (list: GenNode[]) =>
      list.forEach((n) => {
        if (!n.existingId) s.add(n.key);
        walk(n.children);
      });
    walk(g.tree);
    setChecked(s);
  }, [productId]);

  useEffect(() => {
    void run(true, true);
  }, [run]);

  // key → 节点 / 上级，用于联动勾选
  const index = useMemo(() => {
    const node = new Map<string, GenNode>();
    const parent = new Map<string, string | null>();
    const walk = (list: GenNode[], p: string | null) => list.forEach((n) => (node.set(n.key, n), parent.set(n.key, p), walk(n.children, n.key)));
    walk(result?.tree || [], null);
    return { node, parent };
  }, [result]);

  function toggle(n: GenNode, on: boolean) {
    setChecked((prev) => {
      const s = new Set(prev);
      const down = (x: GenNode) => {
        if (!x.existingId) {
          if (on) s.add(x.key);
          else s.delete(x.key);
        }
        x.children.forEach(down);
      };
      down(n);
      // 勾子节点时，新增的上级也要一起建
      if (on) for (let p = index.parent.get(n.key); p; p = index.parent.get(p)) if (!index.node.get(p)?.existingId) s.add(p);
      return s;
    });
  }

  const total = checked.size;

  function payload(list: GenNode[]): ApplyNode[] {
    const out: ApplyNode[] = [];
    for (const n of list) {
      const children = payload(n.children);
      if (checked.has(n.key) || (n.existingId && children.length)) out.push({ type: n.type, name: n.name, existingId: n.existingId, children });
    }
    return out;
  }

  async function apply() {
    if (!result || !total || busy) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/products/${productId}/structure-gen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apply: payload(result.tree) }) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      setError((data as { error?: string }).error || "写入失败，请重试");
      return;
    }
    onDone((data as { created?: number }).created || 0);
  }

  function row(n: GenNode, depth: number): React.ReactNode {
    const exists = Boolean(n.existingId);
    const tag = TYPE_TAG[n.type];
    return (
      <li key={n.key}>
        <div className="nv-sgen-row" style={{ paddingLeft: 12 + depth * 20 }}>
          <input
            type="checkbox"
            aria-label={`${exists ? "已存在：" : "加入："}${n.name}`}
            checked={!exists && checked.has(n.key)}
            disabled={exists}
            onChange={(e) => toggle(n, e.target.checked)}
          />
          <span className={`nv-tag ${tag.tone}`}>{tag.label}</span>
          <span className="nv-sgen-name">{n.name}</span>
          <span className="flex-1" />
          {n.source ? <span className="nv-sgen-src">来自 {n.source}</span> : null}
          <span className={`nv-tag is-dot ${exists ? "is-neutral" : "is-success"}`}>{exists ? "已存在" : "新增"}</span>
        </div>
        {n.children.length ? <ul>{n.children.map((c) => row(c, depth + 1))}</ul> : null}
      </li>
    );
  }

  return (
    <Modal open onClose={onClose} title={`自动生成功能结构 · ${productName}`} busy={busy} panelClassName="nv-prod-modal nv-ftab-preview">
      <div className="nv-pform">
        <p className="nv-pform-intro">从产品文档和需求里提炼「菜单 › 功能模块 › 功能点」。先预览，勾选后加入；同名节点会跳过，不会删除或改动现有结构。</p>
        <div className="nv-pform-body">
          <div className="nv-pfield">
            <span className="nv-pfield-label">来源</span>
            <div className="nv-sgen-src-row">
              <label className="nv-ftab-check">
                <input type="checkbox" checked={docs} onChange={(e) => setDocs(e.target.checked)} />
                产品与项目文档{result ? `（${result.sources.docs} 篇）` : ""}
              </label>
              <label className="nv-ftab-check">
                <input type="checkbox" checked={reqs} onChange={(e) => setReqs(e.target.checked)} />
                需求标题与描述{result ? `（${result.sources.reqs} 条）` : ""}
              </label>
              <span className="flex-1" />
              <button type="button" className="btn-secondary nv-head-btn" disabled={loading || (!docs && !reqs)} onClick={() => void run(docs, reqs)}>
                <Sparkle size={14} aria-hidden="true" />
                {loading ? "生成中…" : "重新生成"}
              </button>
            </div>
            <span className="nv-set-hint">
              {result?.mode === "ai"
                ? "生成方式：Claude 提炼（已配置大模型）"
                : "生成方式：按文档标题层级整理（未配置大模型）——一、二级标题 → 菜单 / 模块，下一级标题和列表项 → 功能点；需求按名称挂到对应模块下"}
            </span>
          </div>
          {error ? (
            <div role="alert" className="banner-error" tabIndex={-1}>
              {error}
            </div>
          ) : null}
          {loading && !result ? <p className="nv-set-hint">正在读取文档和需求并整理…</p> : null}
          {result ? (
            <>
              <div className="nv-ftab-chips">
                <span className="nv-tag is-dot is-success">新增 {result.counts.add}</span>
                <span className="nv-tag is-dot is-neutral">已存在 {result.counts.exists}</span>
              </div>
              {result.note ? <p className="nv-set-hint">{result.note}</p> : null}
              {result.tree.length ? <ul className="nv-sgen-tree" aria-busy={loading || undefined}>{result.tree.map((n) => row(n, 0))}</ul> : <p className="nv-itr-empty">没有整理出可加入的结构。</p>}
              {result.tree.length ? <p className="nv-set-hint">已存在的节点按名称匹配，勾选也不会重复创建；功能点只会挂在功能模块下</p> : null}
            </>
          ) : null}
        </div>
        <div className="nv-pform-foot">
          <span className="nv-pform-note">只新增节点，现有结构和已关联的需求不受影响</span>
          <ModalCancelButton className="btn-secondary nv-head-btn" />
          <button type="button" className="btn-primary nv-head-btn" disabled={!total || busy || loading} aria-busy={busy || undefined} onClick={() => void apply()}>
            {busy ? "加入中…" : total ? `加入功能结构（${total}）` : "没有勾选新增节点"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
