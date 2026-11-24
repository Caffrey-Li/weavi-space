"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Clock, Plus, RefreshCw } from "lucide-react";
import { Banner } from "@/components/ui/Banner";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Avatar } from "@/components/ui/Avatar";
import { useConfirm } from "@/components/ui/Confirm";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { LinkModal, autoEveryLabel, type FieldDef, type LinkView } from "./LinkModal";
import { PreviewModal } from "./PreviewModal";

type RunSummary = { at: string; by: string; auto?: boolean; created: number; updated: number; skipped: number; appended: number; errors: string[] };
export type LinkRow = LinkView & {
  id: string;
  projectName: string | null;
  productName: string | null;
  tableName: string | null;
  lastPullAt: string | null;
  lastPushAt: string | null;
  lastPull: RunSummary | null;
  lastPush: RunSummary | null;
  ownerName: string;
  mine: boolean;
  canEdit: boolean;
};
type Scope = "all" | "mine" | "public";
const SCOPES: { key: Scope; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "mine", label: "我的" },
  { key: "public", label: "公用" },
];
const SCOPE_KEY = "pm-ftab-scope";
type Run = { id: string; at: string; message: string | null; result: { direction?: string; error?: boolean; skipped?: number; errors?: string[] } | null; actor: { name: string; avatarUrl: string | null } | null };
type Data = { fields: FieldDef[]; bugFields: FieldDef[]; canManage: boolean; links: LinkRow[]; runs: Run[] };

/** 卡片副标题里的导入路径：导入到 需求池 · 项目「X」；没选项目（11-22 起新行不导入）时显示「未选项目」 */
function scopeText(l: LinkRow) {
  const bug = l.target === "bug";
  const where = l.projectName ? `项目「${l.projectName}」` : `${l.productName ? `产品「${l.productName}」· ` : ""}未选项目（新行不导入）`;
  return `导入到 ${bug ? "Bug" : "需求池"} · ${where}`;
}

export function stamp(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function inScope(l: LinkRow, s: Scope) {
  return s === "all" || (s === "mine" ? l.mine : l.visibility === "public");
}

function runTag(r: Run) {
  if (r.result?.error) return <span className="nv-tag is-dot is-danger">失败</span>;
  if (r.result?.skipped || r.result?.errors?.length) return <span className="nv-tag is-dot is-warning">部分失败</span>;
  return <span className="nv-tag is-dot is-success">成功</span>;
}

/** Figma 36：卡片头「表 / 多」+ 名称 + 类型·表名·项目·映射列数；状态区显示上次拉取 / 回写 */
export function FeishuTablesPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<LinkRow | "new" | null>(null);
  const [preview, setPreview] = useState<{ link: LinkRow; direction: "pull" | "push" } | null>(null);
  const [scope, setScopeState] = useState<Scope>("all");
  // 连接和同步记录都分页显示
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [runPage, setRunPage] = useState(1);
  const [runSize, setRunSize] = useState(20);
  useEffect(() => setPage(1), [scope]);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(SCOPE_KEY);
      if (v === "mine" || v === "public") setScopeState(v);
    } catch {
      /* 本机存储不可用时用默认 */
    }
  }, []);
  const setScope = (s: Scope) => {
    setScopeState(s);
    try {
      window.localStorage.setItem(SCOPE_KEY, s);
    } catch {
      /* 忽略 */
    }
  };

  const load = useCallback(async () => {
    const res = await fetch("/api/feishu-tables", { cache: "no-store" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setError(d.error || "读取失败");
    else setData(d as Data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function remove(l: LinkRow) {
    const ok = await confirm({ title: `删除连接「${l.name}」？`, body: "只删除连接和行对应关系，已导入的需求 / Bug 和飞书表格都不受影响。", confirmLabel: "删除", tone: "danger" });
    if (!ok) return;
    const res = await fetch(`/api/feishu-tables/${l.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(d.error || "删除失败");
    toast.success(`已删除连接「${l.name}」`);
    void load();
  }

  if (!data) return error ? <p className="nv-set-error">{error}</p> : <p className="nv-set-hint">正在读取…</p>;

  return (
    <>
      <header className="nv-ftab-head">
        <div className="nv-set-title">
          <h1>云表格</h1>
          <p>连接飞书电子表格或多维表格，作为需求或 Bug 的入口和回写路径。首次同步必须先「从飞书拉取」；之后「回写飞书」以系统为准，手动执行前都会先预览变更；自动同步只能选一个方向（自动拉取或自动回写）。</p>
        </div>
        {data.canManage ? (
          <button type="button" className="btn-primary nv-head-btn" onClick={() => setEdit("new")}>
            <Plus size={14} aria-hidden="true" />
            新建连接
          </button>
        ) : null}
      </header>

      <Banner title="使用前在飞书开发者后台为应用开通「电子表格」「多维表格」权限，并在表格右上角 ··· › 添加文档应用，把本应用加为可编辑协作者。" />

      {data.links.length ? (
        <div className="nv-pform-seg nv-ftab-scope" role="group" aria-label="按可见范围筛选">
          {SCOPES.map((s) => (
            <button key={s.key} type="button" aria-pressed={scope === s.key} onClick={() => setScope(s.key)}>
              {s.label} {data.links.filter((l) => inScope(l, s.key)).length}
            </button>
          ))}
        </div>
      ) : null}

      {data.links.length === 0 ? <p className="nv-itr-empty">还没有连接。点「新建连接」粘贴飞书表格链接，选择导入到需求池还是 Bug，把各列对应到系统字段；可以设为自用或公用。</p> : null}
      {data.links.length > 0 && !data.links.some((l) => inScope(l, scope)) ? (
        <p className="nv-itr-empty">{scope === "mine" ? "你还没有自己的连接，点「新建连接」添加。" : "还没有公用的连接。"}</p>
      ) : null}

      {data.links.filter((l) => inScope(l, scope)).slice((page - 1) * pageSize, page * pageSize).map((l) => {
        const mapped = Object.keys(l.mapping).length;
        const synced = l.lastPullAt || l.lastPushAt;
        const pullBad = l.lastPull && (l.lastPull.skipped || l.lastPull.errors?.length);
        return (
          <section key={l.id} className="nv-itr-card" aria-label={l.name}>
            <div className="nv-itr-head">
              <span className="nv-itr-icon" aria-hidden="true">
                {l.kind === "bitable" ? "多" : "表"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="nv-itr-title">
                  <span className="nv-itr-title-text">{l.name}</span>
                  <span className={`nv-tag ${l.visibility === "public" ? "is-info" : "is-neutral"}`}>{l.visibility === "public" ? "公用" : "自用"}</span>
                </p>
                <p className="nv-itr-sub">
                  {l.kind === "bitable" ? "多维表格" : "电子表格"} · {l.kind === "bitable" ? "数据表" : "工作表"}「{l.tableName || "—"}」 · {scopeText(l)} · 已映射 {mapped} 列 · 回写{" "}
                  {(l.pushFields || []).length
                    ? (l.pushFields || []).map((k) => [...data.fields, ...data.bugFields].find((f) => f.key === k)?.label || k).join("、")
                    : "无"}{" "}
                  · 创建人 {l.ownerName}
                  {l.mine ? "（我）" : ""}
                </p>
              </div>
              {l.autoSync && l.autoSync !== "off" ? (
                <span className="nv-tag is-dot is-info">
                  {autoEveryLabel(l.autoEvery)}
                  {l.autoSync === "pull" ? "自动拉取" : "自动回写"}
                </span>
              ) : null}
              <span className="nv-tag is-dot is-success">已连接</span>
            </div>
            <div className="nv-itr-status">
              {synced ? (
                pullBad ? <CircleAlert size={16} className="nv-itr-bad" aria-hidden="true" /> : <CircleCheck size={16} className="nv-itr-ok" aria-hidden="true" />
              ) : (
                <Clock size={16} className="nv-itr-none" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="nv-itr-status-title">
                  {l.lastPull ? `上次${l.lastPull.auto ? "自动" : ""}拉取 ${stamp(l.lastPull.at)} · 新增 ${l.lastPull.created}，更新 ${l.lastPull.updated}${l.lastPull.skipped ? `，跳过 ${l.lastPull.skipped}` : ""}` : synced ? "还没有拉取过" : "还没有同步过"}
                </p>
                <p className="nv-itr-sub">
                  {l.lastPush
                    ? `上次${l.lastPush.auto ? "自动" : ""}回写 ${stamp(l.lastPush.at)} · 更新 ${l.lastPush.updated} 行，追加 ${l.lastPush.appended} 行 · 操作人 ${l.lastPush.by}`
                    : synced
                      ? `还没有回写过 · 上次操作人 ${l.lastPull?.by || "—"}`
                      : "先「从飞书拉取」导入已有记录，之后在系统里的修改可以「回写飞书」"}
                </p>
              </div>
              <button type="button" className="btn-secondary nv-head-btn" onClick={() => setPreview({ link: l, direction: "pull" })}>
                <RefreshCw size={14} aria-hidden="true" />
                从飞书拉取
              </button>
              <button
                type="button"
                className="btn-secondary nv-head-btn"
                onClick={() => setPreview({ link: l, direction: "push" })}
                disabled={!l.lastPullAt}
                title={l.lastPullAt ? undefined : "首次同步需要先从飞书拉取"}
              >
                回写飞书
              </button>
              <ActionMenu
                label={`${l.name} 的更多操作`}
                items={[
                  { label: "编辑连接", onSelect: () => setEdit(l), disabled: !l.canEdit },
                  { label: "打开飞书表格", onSelect: () => window.open(l.url, "_blank", "noopener") },
                  { label: "删除连接", tone: "danger", onSelect: () => void remove(l), disabled: !l.canEdit },
                ]}
              />
            </div>
          </section>
        );
      })}

      {data.links.filter((l) => inScope(l, scope)).length > pageSize ? (
        <Pagination total={data.links.filter((l) => inScope(l, scope)).length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
      ) : null}

      <section className="nv-itr-log" aria-labelledby="ftab-log-title">
        <h2 id="ftab-log-title">最近同步记录</h2>
        {data.runs.length === 0 ? (
          <p className="nv-itr-empty">还没有同步记录。</p>
        ) : (
          <ul className="nv-itr-list">
            {data.runs.slice((runPage - 1) * runSize, runPage * runSize).map((r) => (
              <li key={r.id}>
                <time dateTime={r.at}>{stamp(r.at)}</time>
                <span className="nv-itr-col-tag">{runTag(r)}</span>
                <span className="nv-itr-col-text" title={r.message || ""}>
                  {r.message}
                </span>
                <span className="nv-itr-who">
                  <Avatar name={r.actor?.name || "系统"} src={r.actor?.avatarUrl} size={16} />
                  {r.actor?.name || "系统"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data.runs.length > runSize ? <Pagination total={data.runs.length} page={runPage} pageSize={runSize} onPageChange={setRunPage} onPageSizeChange={(n) => { setRunSize(n); setRunPage(1); }} /> : null}
      </section>

      {edit ? (
        <LinkModal
          fieldsByTarget={{ requirement: data.fields, bug: data.bugFields }}
          link={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={(name) => {
            setEdit(null);
            toast.success(edit === "new" ? `已新建连接「${name}」，可以先「从飞书拉取」` : "已保存连接");
            void load();
          }}
        />
      ) : null}
      {preview ? (
        <PreviewModal
          link={preview.link}
          direction={preview.direction}
          onClose={() => setPreview(null)}
          onDone={(msg) => {
            setPreview(null);
            toast.success(msg);
            void load();
          }}
        />
      ) : null}
    </>
  );
}
