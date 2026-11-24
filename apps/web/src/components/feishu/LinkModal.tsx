"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";

export type FieldDef = { key: string; label: string; required?: boolean; multi?: boolean };
type MapValue = string | string[];
const asList = (v: MapValue | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
export type Target = "requirement" | "bug";
export type AutoSync = "off" | "pull" | "push";
export type LinkView = {
  name: string;
  kind: "sheet" | "bitable";
  url: string;
  tableId: string;
  headerRow: number;
  /** 空字符串 = 不指定项目（公共池） */
  projectId: string;
  productId?: string | null;
  target?: Target;
  mapping: Record<string, MapValue>;
  appendOnPush: boolean;
  pushFields?: string[];
  autoTitle?: boolean;
  visibility?: "private" | "public";
  autoSync?: AutoSync;
  autoEvery?: number;
};
export const AUTO_EVERY_OPTIONS = [
  { value: 15, label: "每 15 分钟" },
  { value: 30, label: "每 30 分钟" },
  { value: 60, label: "每小时" },
  { value: 180, label: "每 3 小时" },
  { value: 720, label: "每 12 小时" },
  { value: 1440, label: "每天" },
];
export const autoEveryLabel = (n?: number) => AUTO_EVERY_OPTIONS.find((o) => o.value === n)?.label || "每小时";
type ProjectOpt = { id: string; name: string; productId: string | null };
type ProductOpt = { id: string; name: string };
type Inspect = { kind: "sheet" | "bitable"; tables: { id: string; title: string }[]; tableId: string; columns: string[]; rows: number; headerRow: number; imageCols?: Record<string, number> };

/** 按表头文字猜映射，用户可再改 */
const GUESS: Record<string, RegExp> = {
  title: /^(标题|需求名称|需求标题|功能|功能点|需求|名称)$/,
  status: /状态|进度/,
  priority: /优先级/,
  severity: /严重|级别|等级|优先级/,
  dueAt: /截止|期望|计划|完成日期/,
  product: /产品|对接人|负责人/,
  frontend: /前端/,
  backend: /后端/,
  qa: /测试/,
  startAt: /开始/,
  plannedEndAt: /计划|期望|截止|上线日期|完成日期/,
  summary: /描述|说明|备注|详情|截图|图片|附件/,
  code: /编号|系统编号|需求ID/i,
};
function guess(fields: FieldDef[], columns: string[]) {
  const used = new Set<string>();
  const out: Record<string, MapValue> = {};
  for (const f of fields) {
    // 描述可以合并多列：描述、截图、附件等一起带上
    const hits = columns.filter((col) => !used.has(col) && GUESS[f.key]?.test(col.trim()));
    const pick = f.key === "summary" ? hits.slice(0, 6) : hits.slice(0, 1);
    if (pick.length) {
      out[f.key] = pick.length > 1 ? pick : pick[0];
      pick.forEach((c) => used.add(c));
    }
  }
  if (!out.title) {
    const c = columns.find((col) => !used.has(col));
    if (c) out.title = c;
  }
  return out;
}

/** Figma 37：新建 / 编辑表格连接 */
export function LinkModal({
  fieldsByTarget,
  link,
  onClose,
  onSaved,
}: {
  fieldsByTarget: Record<Target, FieldDef[]>;
  link: (LinkView & { id: string; lastPullAt?: string | null }) | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const baseId = useId();
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [name, setName] = useState(link?.name || "");
  const [url, setUrl] = useState(link?.url || "");
  // 导入到需求池 / Bug；所属项目（可不选 = 公共池）；不选项目时可以只选产品
  const [target, setTarget] = useState<Target>(link?.target || "requirement");
  const fields = fieldsByTarget[target];
  const [projectId, setProjectId] = useState(link?.projectId || "");
  const [productId, setProductId] = useState(link?.productId || "");
  const [autoSync, setAutoSync] = useState<AutoSync>(link?.autoSync || "off");
  const [autoEvery, setAutoEvery] = useState(link?.autoEvery || 60);
  const [tableId, setTableId] = useState(link?.tableId || "");
  const [mapping, setMapping] = useState<Record<string, MapValue>>(link?.mapping || {});
  const [appendOnPush, setAppendOnPush] = useState(link ? link.appendOnPush : false);
  // 「回写飞书」只写勾选的列，默认只回写状态
  const [pushFields, setPushFields] = useState<string[]>(link?.pushFields || ["status"]);
  const [autoTitle, setAutoTitle] = useState(link?.autoTitle === true);
  // 新建默认自用；已有连接按原设置
  const [visibility, setVisibility] = useState<"private" | "public">(link ? link.visibility || "public" : "private");
  const [info, setInfo] = useState<Inspect | null>(null);
  const [reading, setReading] = useState(false);
  const [readErr, setReadErr] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lastRead = useRef("");

  useEffect(() => {
    void fetch("/api/meta", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { projects?: ProjectOpt[]; products?: ProductOpt[] }) => {
        setProjects(d.projects || []);
        setProducts(d.products || []);
        if (!link && d.projects?.[0]) setProjectId((p) => p || d.projects![0].id);
      })
      .catch(() => {});
    if (link) void inspect(link.url, link.tableId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function inspect(u: string, tid: string | undefined, remap: boolean) {
    if (!u.trim()) return;
    const key = `${u}|${tid || ""}`;
    if (key === lastRead.current) return;
    lastRead.current = key;
    setReading(true);
    setReadErr("");
    const res = await fetch("/api/feishu-tables/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: u, tableId: tid }) });
    const d = await res.json().catch(() => ({}));
    setReading(false);
    if (!res.ok) {
      setInfo(null);
      setReadErr(d.error || "读取失败");
      lastRead.current = "";
      return;
    }
    const i = d as Inspect;
    setInfo(i);
    setTableId(i.tableId);
    if (remap) setMapping(guess(fields, i.columns));
    else
      setMapping((m) =>
        Object.fromEntries(
          Object.entries(m)
            .map(([k, v]) => [k, Array.isArray(v) ? v.filter((c) => i.columns.includes(c)) : v] as [string, MapValue])
            .filter(([, v]) => (Array.isArray(v) ? v.length : i.columns.includes(v))),
        ),
      );
    if (!name.trim()) setName(i.tables.find((t) => t.id === i.tableId)?.title || "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!info) return setError(readErr || "请先粘贴表格链接并等待读取完成");
    if (!asList(mapping.title).length) return setError("请为「标题」选择对应的列");
    setBusy(true);
    setError("");
    const body = {
      name,
      url,
      tableId,
      headerRow: info.kind === "sheet" ? info.headerRow : 1,
      target,
      projectId: projectId || null,
      productId: projectId ? null : productId || null,
      mapping,
      appendOnPush,
      pushFields,
      autoTitle,
      visibility,
      autoSync,
      autoEvery,
    };
    const res = await fetch(link ? `/api/feishu-tables/${link.id}` : "/api/feishu-tables", { method: link ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(d.error || "保存失败");
    onSaved(name.trim());
  }

  /** 切换导入目标：去掉新目标没有的字段，新目标独有的字段按表头重新猜 */
  function changeTarget(next: Target) {
    if (next === target) return;
    setTarget(next);
    const keys = new Set(fieldsByTarget[next].map((f) => f.key));
    const guessed = info ? guess(fieldsByTarget[next], info.columns) : {};
    setMapping((m) => {
      const kept = Object.fromEntries(Object.entries(m).filter(([k]) => keys.has(k)));
      const used = new Set(Object.values(kept).flatMap((v) => asList(v)));
      for (const [k, v] of Object.entries(guessed)) if (!kept[k] && asList(v).every((c) => !used.has(c))) kept[k] = v;
      return kept;
    });
    setPushFields((p) => p.filter((k) => keys.has(k)));
  }

  const tableTitle = info?.tables.find((t) => t.id === tableId)?.title;
  const project = projects.find((p) => p.id === projectId);
  const projectProduct = project?.productId ? products.find((p) => p.id === project.productId) : null;
  const noun = target === "bug" ? "Bug" : "需求";
  const dirty = !link
    ? Boolean(url || name)
    : name !== link.name ||
      url !== link.url ||
      JSON.stringify(mapping) !== JSON.stringify(link.mapping) ||
      JSON.stringify(pushFields) !== JSON.stringify(link.pushFields || ["status"]) ||
      target !== (link.target || "requirement") ||
      projectId !== link.projectId ||
      (!projectId && productId !== (link.productId || "")) ||
      appendOnPush !== link.appendOnPush ||
      autoTitle !== (link.autoTitle === true) ||
      visibility !== (link.visibility || "public") ||
      autoSync !== (link.autoSync || "off") ||
      autoEvery !== (link.autoEvery || 60);

  return (
    <Modal open onClose={onClose} title={link ? "编辑表格连接" : "新建表格连接"} dirty={dirty} busy={busy} panelClassName="nv-prod-modal nv-ftab-modal">
      <form onSubmit={submit} className="nv-pform" noValidate>
        <p className="nv-pform-intro">粘贴飞书电子表格或多维表格的链接，选择导入到需求池还是 Bug、所属项目或产品，再把各列对应到系统字段。</p>
        <div className="nv-pform-body">
          {error ? (
            <div role="alert" className="banner-error" tabIndex={-1}>
              {error}
            </div>
          ) : null}
          <label className="nv-pfield" htmlFor={`${baseId}-name`}>
            <span className="nv-pfield-label">连接名称</span>
            <input id={`${baseId}-name`} className="input" value={name} maxLength={60} placeholder="如：客户需求收集" data-initial-focus="" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="nv-pfield">
            <label className="nv-pfield-label" htmlFor={`${baseId}-url`}>
              表格链接
            </label>
            <input
              id={`${baseId}-url`}
              className="input"
              value={url}
              placeholder="https://xxx.feishu.cn/base/… 或 /sheets/…"
              spellCheck={false}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => void inspect(url, undefined, !link || url !== link.url)}
              onPaste={(e) => {
                const v = e.clipboardData.getData("text");
                if (v) setTimeout(() => void inspect(v.trim(), undefined, true), 0);
              }}
            />
            <div className="nv-ftab-read" aria-live="polite">
              {reading ? (
                <span className="nv-set-hint">正在读取表格…</span>
              ) : readErr ? (
                <span className="nv-set-error">{readErr}</span>
              ) : info ? (
                <>
                  <span className="nv-tag is-dot is-success">{info.kind === "bitable" ? "多维表格" : "电子表格"}</span>
                  <span className="nv-set-hint">
                    已读取{info.kind === "bitable" ? "数据表" : "工作表"}「{tableTitle}」 · {info.rows} {info.kind === "bitable" ? "条记录" : "行数据"} · {info.columns.length} 个{info.kind === "bitable" ? "字段" : "列"}
                    {info.kind === "sheet" && info.headerRow > 1 ? ` · 表头在第 ${info.headerRow} 行` : ""}
                    {Object.keys(info.imageCols || {}).length ? ` · 含 ${Object.values(info.imageCols || {}).reduce((a, b) => a + b, 0)} 张单元格图片` : ""}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <div className="nv-ftab-two">
            <div className="nv-pfield">
              <span className="nv-pfield-label" id={`${baseId}-target`}>
                导入到
              </span>
              <div className="nv-pform-seg nv-ftab-seg" role="group" aria-labelledby={`${baseId}-target`}>
                <button type="button" aria-pressed={target === "requirement"} onClick={() => changeTarget("requirement")}>
                  需求池
                </button>
                <button type="button" aria-pressed={target === "bug"} onClick={() => changeTarget("bug")}>
                  Bug
                </button>
              </div>
              <span className="nv-set-hint">拉取时新建为需求还是 Bug；回写只写这个范围内的记录</span>
            </div>
            <label className="nv-pfield" htmlFor={`${baseId}-tab`}>
              <span className="nv-pfield-label">工作表 / 数据表</span>
              <select
                id={`${baseId}-tab`}
                className="input"
                value={tableId}
                disabled={!info}
                onChange={(e) => {
                  setTableId(e.target.value);
                  void inspect(url, e.target.value, true);
                }}
              >
                {(info?.tables || []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <span className="nv-set-hint">多维表格按字段名对应；电子表格会自动识别表头所在行</span>
            </label>
          </div>
          <div className="nv-ftab-two">
            <label className="nv-pfield" htmlFor={`${baseId}-proj`}>
              <span className="nv-pfield-label">所属项目</span>
              <select id={`${baseId}-proj`} className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">不指定（新行不导入）</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="nv-set-hint">需求和 Bug 必须属于项目：不指定时只更新以前导入过的记录，表格里的新行不会导入</span>
            </label>
            <label className="nv-pfield" htmlFor={`${baseId}-prod`}>
              <span className="nv-pfield-label">所属产品</span>
              {projectId ? (
                <select id={`${baseId}-prod`} className="input" value={project?.productId || ""} disabled>
                  <option value="">{projectProduct ? `${projectProduct.name}（跟随项目）` : "项目未关联产品"}</option>
                  {projectProduct ? <option value={projectProduct.id}>{projectProduct.name}（跟随项目）</option> : null}
                </select>
              ) : (
                <select id={`${baseId}-prod`} className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">不指定</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <span className="nv-set-hint">选了项目时跟随项目的产品；不选项目时可以只指定产品</span>
            </label>
          </div>
          <div className="nv-pfield">
            <span className="nv-pfield-label" id={`${baseId}-vis`}>
              可见范围
            </span>
            <div className="nv-pform-seg nv-ftab-vis" role="group" aria-labelledby={`${baseId}-vis`}>
              <button type="button" aria-pressed={visibility === "private"} onClick={() => setVisibility("private")}>
                自用
              </button>
              <button type="button" aria-pressed={visibility === "public"} onClick={() => setVisibility("public")}>
                公用
              </button>
            </div>
            <span className="nv-set-hint">自用：只有你能看到和同步；公用：所有人都能看到并拉取 / 回写，只有你能编辑和删除</span>
          </div>
          <div className="nv-pfield">
            <span className="nv-pfield-label" id={`${baseId}-auto`}>
              自动同步
            </span>
            <div className="nv-ftab-auto">
              <div className="nv-pform-seg nv-ftab-seg" role="group" aria-labelledby={`${baseId}-auto`}>
                {(
                  [
                    ["off", "关闭"],
                    ["pull", "自动拉取"],
                    ["push", "自动回写"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={autoSync === k}
                    onClick={() => setAutoSync(k)}
                    // 首次同步必须先拉取：没拉取过的连接不能设为自动回写
                    disabled={k === "push" && !link?.lastPullAt}
                    title={k === "push" && !link?.lastPullAt ? "首次同步需要先从飞书拉取" : undefined}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {autoSync !== "off" ? (
                <select className="input" aria-label="自动同步间隔" value={autoEvery} onChange={(e) => setAutoEvery(Number(e.target.value))}>
                  {AUTO_EVERY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            <span className="nv-set-hint">
              {autoSync === "off"
                ? "关闭时只能手动拉取 / 回写，执行前先预览。"
                : "单向：只按选定方向定时执行，不再预览；以创建人的权限执行，结果记入同步记录。另一个方向仍可手动操作。"}
            </span>
          </div>
          <div className="nv-pfield">
            <span className="nv-pfield-label">字段映射</span>
            <div className="nv-ftab-map" role="table" aria-label="字段映射">
              <div className="nv-ftab-map-row is-head" role="row">
                <span role="columnheader">系统字段</span>
                <span aria-hidden="true" />
                <span role="columnheader">表格列</span>
                <span role="columnheader" className="nv-ftab-push-head">回写</span>
              </div>
              {fields.map((f) => {
                const list = asList(mapping[f.key]);
                const set = (next: string[]) => setMapping((m) => ({ ...m, [f.key]: next.length > 1 ? next : next[0] || "" }));
                const select = (value: string, onChange: (v: string) => void, label: string) => (
                  <select className={`input${value ? "" : " is-empty"}`} aria-label={label} value={value} disabled={!info} onChange={(e) => onChange(e.target.value)}>
                    <option value="">{f.key === "code" ? "不对应（回写时可写入编号列）" : "不对应"}</option>
                    {(info?.columns || []).map((c) => (
                      <option key={c} value={c}>
                        {c}
                        {info?.imageCols?.[c] ? `（含 ${info.imageCols[c]} 张图片）` : ""}
                      </option>
                    ))}
                  </select>
                );
                const row = (
                  <div key={f.key} className={`nv-ftab-map-row${f.multi && list.length > 1 ? " is-multi" : ""}`} role="row">
                    <span role="rowheader">
                      {f.label}
                      {f.required ? " *" : ""}
                    </span>
                    <span className="nv-ftab-arrow" aria-hidden="true">
                      ←
                    </span>
                    {(() => {
                      // 回写列勾选：没对应列、合并了多列、或标题按描述生成时不能回写
                      const genTitle = f.key === "title" && autoTitle && asList(mapping.summary).length > 0;
                      const canPush = list.length === 1 && !genTitle;
                      const checked = canPush && pushFields.includes(f.key);
                      return (
                        <span className="nv-ftab-push" role="cell">
                          <input
                            type="checkbox"
                            aria-label={`回写${f.label}`}
                            checked={checked}
                            disabled={!canPush}
                            title={!list.length ? "先选择对应的列" : list.length > 1 ? "合并了多列，不能回写" : genTitle ? "标题按描述生成，不回写" : undefined}
                            onChange={(e) => setPushFields((p) => (e.target.checked ? [...p, f.key] : p.filter((k) => k !== f.key)))}
                          />
                        </span>
                      );
                    })()}
                    {f.multi ? (
                      <div className="nv-ftab-multi">
                        {(list.length ? list : [""]).map((c, i) => (
                          <div key={`${f.key}-${i}`} className="nv-ftab-multi-line">
                            {select(c, (v) => set((list.length ? list : [""]).map((x, j) => (j === i ? v : x)).filter(Boolean)), `${f.label}对应的第 ${i + 1} 列`)}
                            {list.length > 1 ? (
                              <button type="button" className="icon-button" aria-label={`移除「${c}」`} onClick={() => set(list.filter((_, j) => j !== i))}>
                                <X size={14} aria-hidden="true" />
                              </button>
                            ) : null}
                          </div>
                        ))}
                        {list.length && info && list.length < Math.min(8, info.columns.length) ? (
                          <button
                            type="button"
                            className="nv-ftab-add-col"
                            onClick={() => set([...list, info.columns.find((c) => !list.includes(c)) || ""].filter(Boolean))}
                          >
                            + 合并其他列
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      select(list[0] || "", (v) => setMapping((m) => ({ ...m, [f.key]: v })), `${f.label}对应的列`)
                    )}
                  </div>
                );
                if (f.key !== "title") return row;
                const hasDesc = asList(mapping.summary).length > 0;
                return [
                  row,
                  <div key="title-auto" className="nv-ftab-map-sub" role="row">
                    <label className="nv-ftab-check" role="cell" title={hasDesc ? undefined : "先为「描述」选择对应的列"}>
                      <input type="checkbox" checked={autoTitle && hasDesc} disabled={!hasDesc} onChange={(e) => setAutoTitle(e.target.checked)} />
                      根据描述自动生成标题（20 字以内），描述为空时用上面的列
                    </label>
                  </div>,
                ];
              })}
            </div>
          </div>
          <p className="nv-set-hint nv-ftab-map-hint">导入和回写用同一套路径和字段对应。标题、描述可以合并多列：标题用「 · 」连接；描述按列分段，单元格里的图片一起导入正文。「回写飞书」只写勾选的列，默认只回写状态。</p>
          <label className="nv-ftab-check">
            <input type="checkbox" checked={appendOnPush} onChange={(e) => setAppendOnPush(e.target.checked)} />
            回写时，把导入范围内新建、表格中还没有的{noun}追加到表格末尾（写入标题和勾选的列）
          </label>
        </div>
        <div className="nv-pform-foot">
          <span className="nv-pform-note">保存后在列表中「从飞书拉取」，先预览再导入</span>
          <ModalCancelButton className="btn-secondary nv-head-btn" />
          <button type="submit" className="btn-primary nv-head-btn" disabled={busy || reading} aria-busy={busy || undefined}>
            {busy ? "保存中…" : link ? "保存" : "保存连接"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
