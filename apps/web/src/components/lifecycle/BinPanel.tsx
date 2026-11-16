"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { KIND_LABEL, lifecycle, type Kind, type LifecycleAction } from "@/lib/lifecycle-shared";

type Item = { kind: Kind; id: string; name: string; where: string; by: string; at: string; daysLeft?: number; href?: string };
type Data = { items: Item[]; counts: Record<Kind, number>; retentionDays: number; isAdmin: boolean };
type Tab = "archived" | "trash";

const TONE: Record<Kind, string> = { product: "is-warning", project: "is-info", requirement: "is-purple", bug: "is-danger", doc: "is-neutral" };
const FILTERS: ("" | Kind)[] = ["", "product", "project", "requirement", "bug", "doc"];

function stamp(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Figma 44：已归档 / 回收站两个标签，按类型筛选；回收站保留 30 天 */
export function BinPanel({ initialTab }: { initialTab: Tab }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [kind, setKind] = useState<"" | Kind>("");
  const [data, setData] = useState<Record<Tab, Data | null>>({ archived: null, trash: null });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (t: Tab) => {
    const res = await fetch(`/api/lifecycle?tab=${t}`, { cache: "no-store" });
    if (res.ok) {
      const d = (await res.json()) as Data;
      setData((prev) => ({ ...prev, [t]: d }));
    }
  }, []);
  useEffect(() => {
    void load("archived");
    void load("trash");
  }, [load]);

  function switchTab(t: Tab) {
    setTab(t);
    router.replace(t === "trash" ? "/system/bin?tab=trash" : "/system/bin", { scroll: false });
  }

  async function act(it: Item, action: LifecycleAction) {
    if (action === "purge") {
      const ok = await confirm({ title: `彻底删除${KIND_LABEL[it.kind]}「${it.name}」？`, body: "彻底删除后不能恢复，随它一起进入回收站的内容也会一起删除。", confirmLabel: "彻底删除", tone: "danger" });
      if (!ok) return;
    }
    if (action === "delete") {
      const ok = await confirm({ title: `删除${KIND_LABEL[it.kind]}「${it.name}」？`, body: "移入回收站，30 天内可以恢复。", confirmLabel: "删除", tone: "danger" });
      if (!ok) return;
    }
    setBusy(`${it.kind}:${it.id}`);
    const err = await lifecycle(it.kind, it.id, action);
    setBusy(null);
    if (err) return toast.error(err);
    toast.success({ archive: "已归档", unarchive: "已取消归档", delete: "已移入回收站", restore: "已恢复", purge: "已彻底删除" }[action] + `「${it.name}」`);
    void load("archived");
    void load("trash");
    router.refresh();
  }

  const d = data[tab];
  const items = (d?.items || []).filter((i) => !kind || i.kind === kind);
  const isTrash = tab === "trash";

  return (
    <div className="nv-set nv-ftab nv-bin">
      <header className="nv-set-title">
        <h1>归档与回收站</h1>
        <p>归档的内容不再出现在列表和看板里，可以随时恢复；删除的内容进入回收站，保留 30 天后自动彻底删除。删除或归档项目、产品时，下面的需求、Bug、文档一起处理，恢复时一起回来。</p>
      </header>
      <div className="nv-bin-tabs" role="tablist" aria-label="归档与回收站">
        {(["archived", "trash"] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-active" : ""} onClick={() => switchTab(t)}>
            {t === "trash" ? "回收站" : "已归档"} {data[t] ? data[t]!.items.length : ""}
          </button>
        ))}
      </div>
      <div className="nv-bin-filter">
        <div className="nv-pform-seg nv-art-seg" role="group" aria-label="按类型筛选">
          {FILTERS.map((k) => (
            <button key={k || "all"} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k ? KIND_LABEL[k] : "全部"}
            </button>
          ))}
        </div>
        {isTrash ? <span className="nv-set-hint">回收站内容保留 {d?.retentionDays ?? 30} 天，到期自动彻底删除</span> : null}
      </div>
      {!d ? (
        <p className="nv-set-hint">正在读取…</p>
      ) : !items.length ? (
        <p className="nv-itr-empty">{isTrash ? "回收站是空的。" : "没有已归档的内容。"}</p>
      ) : (
        <div className={`nv-bin-table${isTrash ? " is-trash" : ""}`} role="table" aria-label={isTrash ? "回收站" : "已归档"}>
          <div className="nv-bin-row is-head" role="row">
            <span role="columnheader">类型</span>
            <span role="columnheader">名称</span>
            <span role="columnheader">{isTrash ? "删除人" : "归档人"}</span>
            <span role="columnheader">{isTrash ? "删除时间" : "归档时间"}</span>
            {isTrash ? <span role="columnheader">保留</span> : null}
            <span role="columnheader">
              <span className="sr-only">操作</span>
            </span>
          </div>
          {items.map((it) => {
            const key = `${it.kind}:${it.id}`;
            return (
              <div key={key} className="nv-bin-row" role="row">
                <span role="cell">
                  <span className={`nv-tag is-dot ${TONE[it.kind]}`}>{KIND_LABEL[it.kind]}</span>
                </span>
                <span role="cell" className="nv-bin-name">
                  {it.href ? (
                    <Link href={it.href} title={it.name}>
                      {it.name}
                    </Link>
                  ) : (
                    <b title={it.name}>{it.name}</b>
                  )}
                  {it.where ? <small title={it.where}>{it.where}</small> : null}
                </span>
                <span role="cell">{it.by}</span>
                <span role="cell">{stamp(it.at)}</span>
                {isTrash ? <span role="cell">还剩 {it.daysLeft} 天</span> : null}
                <span role="cell" className="nv-bin-ops">
                  {isTrash ? (
                    <>
                      <button type="button" className="btn-secondary nv-head-btn" disabled={busy === key} onClick={() => void act(it, "restore")}>
                        恢复
                      </button>
                      {d.isAdmin ? (
                        <button type="button" className="btn-ghost nv-head-btn text-nv-danger-fg" disabled={busy === key} onClick={() => void act(it, "purge")}>
                          彻底删除
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn-secondary nv-head-btn" disabled={busy === key} onClick={() => void act(it, "unarchive")}>
                        取消归档
                      </button>
                      <button type="button" className="btn-ghost nv-head-btn text-nv-danger-fg" disabled={busy === key} onClick={() => void act(it, "delete")}>
                        删除
                      </button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
