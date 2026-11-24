"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { fmtDate, fmtUpdated } from "@/lib/utils";

type Counts = { personas: number; products: number; projects: number; requirements: number; bugs: number; releases: number; docs: number };
export type DemoStatus = { exists: false } | { exists: true; orgId: string; name: string; code: string | null; builtAt: string | null; counts: Counts };
export type DemoGuest = { id: string; name: string; kind: "readonly" | "editable"; position: string | null; expiresAt: string | null; lastUsedAt: string | null; isActive: boolean; expired: boolean };
type Position = { key: string; name: string };

const STAT_LABELS: [keyof Counts, string][] = [
  ["personas", "演示成员"],
  ["products", "产品"],
  ["projects", "项目"],
  ["requirements", "需求"],
  ["bugs", "Bug"],
  ["releases", "发版"],
  ["docs", "文档"],
];

const when = (iso: string | null) => (iso ? fmtUpdated(iso) : "—");

/**
 * Weavi Space 系统后台 · 演示体验：生成 / 重置 / 删除演示组织（只动演示组织的数据），
 * 登录页一键体验开关，体验账号（只读 / 可编辑，体验链接只显示一次）。
 */
export function NovaDemo({ status, oneClick: initialOneClick, guests: initialGuests, positions }: { status: DemoStatus; oneClick: boolean; guests: DemoGuest[]; positions: Position[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const baseId = useId();
  const [busy, setBusy] = useState<"" | "build" | "delete" | "oneclick">("");
  const [oneClick, setOneClick] = useState(initialOneClick);
  const [guests, setGuests] = useState(initialGuests);
  useEffect(() => setGuests(initialGuests), [initialGuests]);
  useEffect(() => setOneClick(initialOneClick), [initialOneClick]);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"readonly" | "editable">("readonly");
  const [position, setPosition] = useState(positions.find((p) => p.key === "product")?.key || positions[0]?.key || "");
  const [days, setDays] = useState("7");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [link, setLink] = useState<{ url: string; note: string } | null>(null);

  const posName = (k: string | null) => (k ? positions.find((p) => p.key === k)?.name || k : "—");
  const fullUrl = (path: string) => `${window.location.origin}${path}`;

  async function demoAction(action: "build" | "delete") {
    const exists = status.exists;
    const ok = await confirm(
      action === "delete"
        ? { title: "删除演示组织？", body: "会删除演示组织「示例科技」的全部数据、示例成员和体验账号，体验链接全部失效，不能恢复。", confirmLabel: "删除演示组织", tone: "danger" }
        : exists
          ? { title: "重置演示数据？", body: "会清空演示组织里的项目、产品、需求、Bug、发版和文档（包括体验账号新建和修改的内容），再按演示数据重建。体验账号保留。", confirmLabel: "重置", tone: "danger" }
          : { title: "生成演示组织？", body: "会新建独立企业「示例科技」和全套演示数据，和其他企业的数据隔离。", confirmLabel: "生成" },
    );
    if (!ok) return;
    setBusy(action);
    const res = await fetch("/api/nova/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) return toast.error(data.error || "操作失败");
    toast.success(action === "delete" ? "已删除演示组织" : exists ? "演示数据已重置" : "演示组织已生成");
    router.refresh();
  }

  async function toggleOneClick(on: boolean) {
    setBusy("oneclick");
    setOneClick(on);
    const res = await fetch("/api/nova/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "oneclick", on }) });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      setOneClick(!on);
      return toast.error(data.error || "保存失败");
    }
    toast.success(on ? "登录页已显示「以访客身份体验」" : "已关闭登录页一键体验");
  }

  function openCreate() {
    setName("");
    setKind("readonly");
    setDays("7");
    setError("");
    setLink(null);
    setOpen(true);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!name.trim()) return setError("请填写名称");
    setSaving(true);
    setError("");
    const res = await fetch("/api/nova/demo/guests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, kind, position: kind === "editable" ? position : undefined, days: Number(days) }) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(data.error || "创建失败");
    setLink({ url: fullUrl(data.link), note: `${kind === "editable" ? `可编辑 · ${posName(position)}` : "只读"} · 有效期至 ${fmtDate(data.expiresAt)}` });
    router.refresh();
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制体验链接");
    } catch {
      toast.error("复制失败，请手动选中链接复制");
    }
  }

  async function guestAction(g: DemoGuest, action: "relink" | "extend" | "setDays" | "disable" | "enable", days?: number) {
    if (action === "relink") {
      const ok = await confirm({ title: `给「${g.name}」换新链接？`, body: "旧的体验链接会立即失效，新链接只显示一次。", confirmLabel: "换新链接" });
      if (!ok) return;
    }
    const res = await fetch("/api/nova/demo/guests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: g.id, action, days }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "操作失败");
    if (action === "relink") {
      setLink({ url: fullUrl(data.link), note: `${g.kind === "editable" ? `可编辑 · ${posName(g.position)}` : "只读"} · 有效期至 ${fmtDate(data.expiresAt)}` });
      setOpen(true);
    } else toast.success(action === "extend" || action === "setDays" ? `有效期已改到 ${fmtDate(data.expiresAt)}` : action === "disable" ? "已停用" : "已启用");
    router.refresh();
  }

  async function remove(g: DemoGuest) {
    const ok = await confirm({ title: `删除体验账号「${g.name}」？`, body: "体验链接立即失效。它在演示组织里新建的内容会保留，归到演示组织负责人名下。", confirmLabel: "删除", tone: "danger" });
    if (!ok) return;
    const res = await fetch(`/api/nova/demo/guests?id=${encodeURIComponent(g.id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "删除失败");
    setGuests((prev) => prev.filter((x) => x.id !== g.id));
    toast.success("已删除");
  }

  const exists = status.exists;
  return (
    <div className="list-page nv-list-page">
      <div className="nv-workhead">
        <WorkHeader
          crumbs={[{ label: "演示体验", icon: "sparkles" }]}
          actions={
            exists ? (
              <button type="button" className="btn-primary nv-head-btn" onClick={openCreate}>
                新建体验账号
              </button>
            ) : null
          }
        />
      </div>
      <div className="nv-demo-body">
        <p className="nv-pos-note" role="note">
          <Info size={14} aria-hidden="true" />
          给没有账号的人体验系统：演示数据放在独立的演示组织里，和其他企业的数据隔离。
        </p>

        {status.exists ? (
          <section className="nv-demo-card" aria-labelledby={`${baseId}-org`}>
            <div className="nv-demo-card-head">
              <h2 id={`${baseId}-org`}>演示组织</h2>
              <span className="nv-tag is-success">已生成</span>
              <span className="nv-demo-grow" />
              <button type="button" className="btn-secondary nv-head-btn" disabled={Boolean(busy)} onClick={() => void demoAction("build")}>
                {busy === "build" ? "重置中…" : "重置演示数据"}
              </button>
              <button type="button" className="btn-secondary nv-head-btn nv-demo-danger" disabled={Boolean(busy)} onClick={() => void demoAction("delete")}>
                {busy === "delete" ? "删除中…" : "删除演示组织"}
              </button>
            </div>
            <p className="nv-demo-sub" suppressHydrationWarning>
              {status.name}
              {status.code ? ` · 企业编码 ${status.code}` : ""}
              {status.builtAt ? ` · 上次生成 ${when(status.builtAt)}` : ""}
            </p>
            <ul className="nv-demo-stats" aria-label="演示数据">
              {STAT_LABELS.map(([k, label]) => (
                <li key={k}>
                  <b>{status.counts[k]}</b>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
            <p className="nv-demo-hint">重置会清空演示组织里的项目、产品、需求、Bug、发版和文档（包括体验账号新建和修改的内容），再按演示数据重建；体验账号保留。</p>
          </section>
        ) : (
          <section className="nv-demo-card nv-demo-empty" aria-labelledby={`${baseId}-empty`}>
            <h2 id={`${baseId}-empty`}>还没有演示组织</h2>
            <p>生成后会新建独立企业「示例科技」：11 位演示成员、2 个产品、3 个项目，以及需求、Bug、发版、文档等演示数据。</p>
            <button type="button" className="btn-primary nv-head-btn" disabled={Boolean(busy)} onClick={() => void demoAction("build")}>
              {busy === "build" ? "生成中…" : "生成演示组织"}
            </button>
          </section>
        )}

        <section className="nv-demo-card" aria-labelledby={`${baseId}-oc`}>
          <div className="nv-demo-card-head">
            <div className="nv-demo-grow">
              <h2 id={`${baseId}-oc`}>登录页一键体验</h2>
              <p className="nv-demo-sub">开启后登录页显示「以访客身份体验」，任何人点一下就能以只读身份进入演示组织，会话 12 小时。</p>
            </div>
            <label className="nv-switch">
              <input type="checkbox" checked={oneClick} disabled={!exists || busy === "oneclick"} aria-labelledby={`${baseId}-oc`} onChange={(e) => void toggleOneClick(e.target.checked)} />
              <span aria-hidden="true" />
              {oneClick ? "已开启" : "已关闭"}
            </label>
          </div>
        </section>

        {exists ? (
          <section className="nv-demo-card nv-demo-table-card" aria-labelledby={`${baseId}-g`}>
            <div className="nv-demo-card-head nv-demo-pad">
              <h2 id={`${baseId}-g`}>
                体验账号 <span className="section-count">{guests.length}</span>
              </h2>
            </div>
            {guests.length ? (
              <div className="nv-demo-table-scroll">
              <div className="nv-pos-table" role="table" aria-label={`体验账号，共 ${guests.length} 个`}>
                <div className="nv-pos-row nv-demo-row is-head" role="row">
                  <span role="columnheader">名称</span>
                  <span role="columnheader">方式</span>
                  <span role="columnheader">岗位</span>
                  <span role="columnheader">有效期至</span>
                  <span role="columnheader">最近使用</span>
                  <span role="columnheader">状态</span>
                  <span role="columnheader">
                    <span className="sr-only">操作</span>
                  </span>
                </div>
                {guests.map((g) => (
                  <div key={g.id} className="nv-pos-row nv-demo-row" role="row">
                    <span role="cell" className="nv-pos-name">
                      <b>{g.name}</b>
                    </span>
                    <span role="cell">
                      <span className={`nv-tag ${g.kind === "editable" ? "is-info" : "is-neutral"}`}>{g.kind === "editable" ? "可编辑" : "只读"}</span>
                    </span>
                    <span role="cell">{g.kind === "editable" ? posName(g.position) : "—"}</span>
                    <span role="cell">{fmtDate(g.expiresAt)}</span>
                    <span role="cell" suppressHydrationWarning>
                      {when(g.lastUsedAt)}
                    </span>
                    <span role="cell">
                      <span className={`nv-tag ${!g.isActive || g.expired ? "is-neutral" : "is-success"}`}>{!g.isActive ? "已停用" : g.expired ? "已过期" : "有效"}</span>
                    </span>
                    <span role="cell" className="nv-member-more">
                      <ActionMenu
                        label={`${g.name} 的更多操作`}
                        items={[
                          { label: "复制新链接", onSelect: () => void guestAction(g, "relink"), disabled: !g.isActive },
                          // 11-24 有效期改成从今天起 7 / 14 / 30 天（过期的也能直接恢复）
                          ...[7, 14, 30].map((d) => ({ label: `有效期：从今天起 ${d} 天`, onSelect: () => void guestAction(g, "setDays", d) })),
                          g.isActive ? { label: "停用", onSelect: () => void guestAction(g, "disable") } : { label: "启用", onSelect: () => void guestAction(g, "enable") },
                          { label: "删除", tone: "danger", divider: true, onSelect: () => void remove(g) },
                        ]}
                      />
                    </span>
                  </div>
                ))}
              </div>
              </div>
            ) : (
              <p className="nv-demo-hint nv-demo-pad">还没有体验账号。点右上角「新建体验账号」，把体验链接发给对方即可。</p>
            )}
          </section>
        ) : (
          <p className="nv-demo-hint">没有演示组织时，不能新建体验账号，也不能开启登录页一键体验。</p>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={link ? "体验链接" : "新建体验账号"} dirty={!link && Boolean(name)} busy={saving} panelClassName="nv-prod-modal nv-sm-modal">
        {link ? (
          <div className="nv-pform">
            <div className="nv-pform-body">
              <p className="nv-demo-hint">把下面的体验链接发给对方，打开后点「进入体验」即可登录。链接只显示这一次，丢了可以在列表里「复制新链接」。</p>
              <div className="nv-demo-link">
                <input className="input" readOnly value={link.url} aria-label="体验链接" onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn-primary nv-head-btn" onClick={() => void copy(link.url)}>
                  复制
                </button>
              </div>
              <p className="nv-demo-hint">{link.note}</p>
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note" />
              <button type="button" className="btn-secondary nv-head-btn" onClick={() => setOpen(false)}>
                完成
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={create} className="nv-pform" noValidate>
            <div className="nv-pform-body">
              {error ? (
                <div role="alert" className="banner-error" tabIndex={-1}>
                  {error}
                </div>
              ) : null}
              <label className="nv-pfield" htmlFor={`${baseId}-name`}>
                <span className="nv-pfield-label">名称</span>
                <input id={`${baseId}-name`} className="input" value={name} maxLength={30} placeholder="例如 客户演示 · 华东区" data-initial-focus="" onChange={(e) => setName(e.target.value)} />
              </label>
              <fieldset className="nv-pfield nv-demo-kinds">
                <legend className="nv-pfield-label">方式</legend>
                {(
                  [
                    ["readonly", "只读", "只能查看演示组织的页面，不能新建或修改。"],
                    ["editable", "可编辑", "能在演示组织里新建和修改需求、Bug、文档等；重置演示数据时会清掉这些改动。"],
                  ] as const
                ).map(([k, title, desc]) => (
                  <label key={k} className={`nv-demo-kind${kind === k ? " is-active" : ""}`}>
                    <input type="radio" name={`${baseId}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} />
                    <span>
                      <b>{title}</b>
                      <small>{desc}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              {kind === "editable" ? (
                <label className="nv-pfield" htmlFor={`${baseId}-pos`}>
                  <span className="nv-pfield-label">岗位</span>
                  <select id={`${baseId}-pos`} className="input" value={position} onChange={(e) => setPosition(e.target.value)}>
                    {positions.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="nv-pfield" htmlFor={`${baseId}-days`}>
                <span className="nv-pfield-label">有效期</span>
                <select id={`${baseId}-days`} className="input" value={days} onChange={(e) => setDays(e.target.value)}>
                  <option value="7">7 天（默认）</option>
                  <option value="14">14 天</option>
                  <option value="30">30 天</option>
                </select>
              </label>
              <p className="nv-demo-hint">到期后链接和登录都失效；体验账号不能使用 AI 动手模式、不能创建 API 令牌。</p>
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note" />
              <ModalCancelButton className="btn-secondary nv-head-btn" />
              <button type="submit" className="btn-primary nv-head-btn" disabled={saving} aria-busy={saving || undefined}>
                {saving ? "创建中…" : "创建"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
