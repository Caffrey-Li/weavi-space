"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { RouteTabs } from "@/components/ui/RouteTabs";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { BUG_STATUS, REQ_STATUS } from "@/lib/constants";

/** AI · 任务页（T27 二期，Figma「81」103 任务 / 104 自动化规则 / 新建规则弹窗） */

type Project = { id: string; name: string };
type TaskRow = {
  id: string;
  status: string;
  goal: string;
  model: string;
  steps: number;
  maxSteps: number;
  tokens: number;
  source: string;
  rule: { id: string; name: string; triggerType: string; event: string | null; freq: string | null; time: string | null } | null;
  trigger: string | null;
  conversationId: string | null;
  error: string | null;
  lastStep: string | null;
  createdAt: string | null;
};
type TaskList = { status: string; page: number; size: number; total: number; counts: Record<string, number>; tasks: TaskRow[] };

export const STATUS_LABEL: Record<string, string> = { queued: "排队中", running: "进行中", waiting: "等你确认", done: "已完成", failed: "没做完", cancelled: "已停止" };
export function StatusChip({ status }: { status: string }) {
  return <span className={`nv-agt-st is-${status}`}>{STATUS_LABEL[status] || status}</span>;
}

const pad = (n: number) => String(n).padStart(2, "0");
export function when(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${hm}`;
}

export function AgentTasksPanel({ tab, projects }: { tab: "tasks" | "rules"; projects: Project[] }) {
  return (
    <div className="nv-set nv-ftab nv-agt">
      <header className="nv-set-title">
        <h1>{tab === "rules" ? "自动化规则" : "任务"}</h1>
        <p>
          {tab === "rules"
            ? "规则 = 什么时候（系统事件或定时）+ 让小围做什么。小围用规则创建人的权限和模型执行，查数据直接做，写操作仍然发给你确认；小围的操作连锁触发规则超过 5 层时自动停止。"
            : "小围动手做的所有任务：对话里发起的，和自动化规则触发的。写操作都要你确认后才执行；等确认期间任务挂起，不占模型。"}
        </p>
      </header>
      <RouteTabs
        label="AI 任务"
        current={tab}
        tabs={[
          { key: "tasks", label: "任务", href: "/ai/tasks" },
          { key: "rules", label: "自动化规则", href: "/ai/tasks?tab=rules" },
        ]}
      />
      {tab === "rules" ? <RulesTab projects={projects} /> : <TasksTab />}
    </div>
  );
}

// ---------- 任务 ----------

const FILTERS = [
  { key: "waiting", label: "等我确认", count: "waiting" },
  { key: "active", label: "进行中", count: "active" },
  { key: "done", label: "已完成" },
  { key: "stopped", label: "失败 / 已停止" },
  { key: "all", label: "全部" },
];

function TasksTab() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<TaskList | null>(null);
  const status = sp.get("status") || "";
  const source = sp.get("source") || "";
  const page = Number(sp.get("page") || 1);

  const go = useCallback(
    (patch: Record<string, string>) => {
      const q = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) (v ? q.set(k, v) : q.delete(k));
      router.replace(`${pathname}?${q.toString()}`);
    },
    [pathname, router, sp],
  );

  useEffect(() => {
    let alive = true;
    const load = () => {
      const q = new URLSearchParams({ status: status || "", source, page: String(page) });
      // 没选状态时：有等确认的先看等确认，否则看全部
      if (!status) q.set("status", "all");
      return fetch(`/api/ai/agent/tasks?${q}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setData(d))
        .catch(() => undefined);
    };
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [status, source, page]);

  const current = status || "all";
  return (
    <section className="nv-skill-sec" aria-label="任务列表">
      <div className="nv-agt-filters">
        <div className="nv-agt-chips" role="group" aria-label="按状态筛选">
          {FILTERS.map((f) => {
            const n = f.count && data ? data.counts[f.count] : 0;
            return (
              <button key={f.key} type="button" className="nv-agt-chip" aria-pressed={current === f.key} onClick={() => go({ status: f.key === "all" ? "" : f.key, page: "" })}>
                {f.label}
                {n ? ` ${n}` : ""}
              </button>
            );
          })}
        </div>
        <label className="nv-agt-source">
          来源
          <select className="input" value={source} onChange={(e) => go({ source: e.target.value, page: "" })}>
            <option value="">全部</option>
            <option value="chat">对话</option>
            <option value="rule">自动化规则</option>
          </select>
        </label>
      </div>
      {data && data.tasks.length ? (
        <div className="nv-token-table nv-agt-table" role="table" aria-label="任务">
          <div role="row" className="nv-agt-row is-head">
            <span role="columnheader">状态</span>
            <span role="columnheader">任务</span>
            <span role="columnheader">来源</span>
            <span role="columnheader">用量</span>
            <span role="columnheader">时间</span>
            <span role="columnheader">
              <span className="sr-only">操作</span>
            </span>
          </div>
          {data.tasks.map((t) => (
            <div role="row" key={t.id} className="nv-agt-row">
              <span role="cell">
                <StatusChip status={t.status} />
              </span>
              <span role="cell" className="nv-agt-two">
                <Link href={`/ai/tasks/${t.id}`} className="nv-agt-title">
                  {t.goal}
                </Link>
                <small className={t.status === "waiting" ? "is-waiting" : undefined}>{t.status === "failed" || t.status === "cancelled" ? t.error || t.lastStep || "" : t.lastStep || ""}</small>
              </span>
              <span role="cell" className="nv-agt-two">
                <span>{t.source === "rule" ? `规则「${t.rule?.name || "已删除"}」` : "对话"}</span>
                <small>{t.source === "rule" ? t.trigger || "" : t.conversationId ? <Link href={`/ai?c=${t.conversationId}`}>打开对话</Link> : ""}</small>
              </span>
              <span role="cell">{t.steps ? `${t.steps} 步 · ${t.tokens.toLocaleString()}` : "—"}</span>
              <span role="cell" suppressHydrationWarning>
                {when(t.createdAt)}
              </span>
              <span role="cell">
                <Link href={`/ai/tasks/${t.id}`} className="text-link">
                  {t.status === "waiting" ? "去确认" : "查看"}
                </Link>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="nv-skills-empty">{data ? (current === "waiting" ? "没有等你确认的任务。" : "还没有任务。在 AI 对话里打开「动手模式」，或建一条自动化规则。") : "加载中…"}</p>
      )}
      {data && data.total > data.size ? <Pagination total={data.total} page={data.page} pageSize={data.size} onPageChange={(p) => go({ page: String(p) })} /> : null}
    </section>
  );
}

// ---------- 自动化规则 ----------

type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  triggerType: "event" | "schedule";
  event: string | null;
  eventStatus: string | null;
  freq: string | null;
  weekday: number | null;
  time: string | null;
  triggerLabel: string;
  projectId: string | null;
  projectName: string | null;
  prompt: string;
  credentialId: string;
  model: string;
  runCount: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastNote: string | null;
};
type RulesData = {
  rules: Rule[];
  events: { key: string; label: string }[];
  freqs: { key: string; label: string }[];
  maxRunsPerRule: number;
  budget: { allowRules: boolean; ruleRunsPerDay: number; runsToday: number };
};
type ModelOpt = { credentialId: string; model: string; label: string; disabled: boolean; reason?: string };
type Form = Omit<Rule, "id" | "triggerLabel" | "projectName" | "runCount" | "lastRunAt" | "lastStatus" | "lastNote">;
const EMPTY: Form = { name: "", enabled: true, triggerType: "schedule", event: "req_created", eventStatus: null, freq: "daily", weekday: 1, time: "09:00", projectId: null, prompt: "", credentialId: "", model: "" };
const WEEK = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function lastText(r: Rule) {
  if (!r.lastStatus) return "还没运行";
  const t = when(r.lastRunAt);
  if (r.lastStatus === "started") return `${t || "最近"} · 已运行（共 ${r.runCount} 次）`;
  return `${r.lastStatus === "failed" ? "没运行成" : "跳过"}：${r.lastNote || ""}`;
}

function RulesTab({ projects }: { projects: Project[] }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<RulesData | null>(null);
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);

  const load = useCallback(async () => {
    const [r, m] = await Promise.all([fetch("/api/ai/agent/rules", { cache: "no-store" }).then((x) => x.json()), fetch("/api/ai/models", { cache: "no-store" }).then((x) => x.json())]);
    setData(r);
    setModels(m.options || []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(r: Rule, enabled: boolean) {
    const res = await fetch(`/api/ai/agent/rules/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(d.error || "保存失败");
    toast.success(enabled ? "已启用" : "已停用");
    void load();
  }

  function openNew() {
    const first = models.find((m) => !m.disabled);
    setEditing({ id: null, form: { ...EMPTY, credentialId: first?.credentialId || "", model: first?.model || "" } });
  }

  const blocked = data && !data.budget.allowRules;
  return (
    <section className="nv-skill-sec" aria-label="我的规则">
      <div className="nv-skill-sec-head">
        <h2>
          我的规则 <span className="section-count">{data?.rules.length ?? ""}</span>
        </h2>
        <button type="button" className="btn-primary nv-head-btn" disabled={!data || Boolean(blocked)} title={blocked ? "企业管理员已关闭自动化规则" : undefined} onClick={openNew}>
          <Plus size={14} aria-hidden="true" />
          新建规则
        </button>
      </div>
      {blocked ? <div className="banner-warning" role="status">企业管理员已关闭自动化规则，已有规则不会再运行。</div> : null}
      {data && data.rules.length ? (
        <div className="nv-token-table nv-agt-table" role="table" aria-label="我的规则">
          <div role="row" className="nv-agt-rule is-head">
            <span role="columnheader">
              <span className="sr-only">启用</span>
            </span>
            <span role="columnheader">规则</span>
            <span role="columnheader">触发</span>
            <span role="columnheader">让小围做什么</span>
            <span role="columnheader">最近运行</span>
            <span role="columnheader">
              <span className="sr-only">操作</span>
            </span>
          </div>
          {data.rules.map((r) => (
            <div role="row" key={r.id} className={`nv-agt-rule${r.enabled ? "" : " is-off"}`}>
              <span role="cell">
                <label className="nv-switch">
                  <input type="checkbox" checked={r.enabled} aria-label={`启用「${r.name}」`} onChange={(e) => void toggle(r, e.target.checked)} />
                  <span aria-hidden="true" />
                </label>
              </span>
              <span role="cell" className="nv-agt-two">
                <b>{r.name}</b>
                <small>{r.projectName || "全部项目"}</small>
              </span>
              <span role="cell">{r.triggerLabel}</span>
              <span role="cell" className="nv-agt-prompt" title={r.prompt}>
                {r.prompt}
              </span>
              <span role="cell" className={r.lastStatus === "skipped" || r.lastStatus === "failed" ? "is-bad" : undefined} title={r.lastNote || undefined} suppressHydrationWarning>
                {lastText(r)}
              </span>
              <span role="cell" className="nv-agt-ops">
                <button type="button" className="text-link" onClick={() => setEditing({ id: r.id, form: { name: r.name, enabled: r.enabled, triggerType: r.triggerType, event: r.event || "req_created", eventStatus: r.eventStatus, freq: r.freq || "daily", weekday: r.weekday || 1, time: r.time || "09:00", projectId: r.projectId, prompt: r.prompt, credentialId: r.credentialId, model: r.model } })}>
                  编辑
                </button>
                <button
                  type="button"
                  className="text-link"
                  onClick={async () => {
                    if (!(await confirm({ title: `删除规则「${r.name}」？`, body: "已经运行过的任务会保留。", confirmLabel: "删除", tone: "danger" }))) return;
                    await fetch(`/api/ai/agent/rules/${r.id}`, { method: "DELETE" });
                    void load();
                  }}
                >
                  删除
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="nv-skills-empty">{data ? "还没有规则。比如：每天 9 点把逾期需求列出来提醒负责人；新 Bug 进来时检查严重程度是否合理。" : "加载中…"}</p>
      )}
      {data ? (
        <p className="nv-skill-note">
          每条规则每天最多运行 {data.maxRunsPerRule} 次；本企业今天已运行 {data.budget.runsToday} / {data.budget.ruleRunsPerDay} 次（企业超管在「模型管理 › 小围动手预算」里调整）。
        </p>
      ) : null}
      {editing && data ? <RuleModal key={editing.id || "new"} id={editing.id} initial={editing.form} projects={projects} models={models} data={data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
    </section>
  );
}

function RuleModal({ id, initial, projects, models, data, onClose, onSaved }: { id: string | null; initial: Form; projects: Project[]; models: ModelOpt[]; data: RulesData; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const uid = useId();
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const statusOptions = f.event === "req_status" ? REQ_STATUS : f.event === "bug_status" ? BUG_STATUS : null;
  const modelKey = f.credentialId && f.model ? `${f.credentialId}|${f.model}` : "";
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(id ? `/api/ai/agent/rules/${id}` : "/api/ai/agent/rules", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(d.error || "保存失败");
      toast.success("已保存");
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={id ? "编辑自动化规则" : "新建自动化规则"} busy={busy} dirty={dirty}>
      <form
        className="nv-pform"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="nv-pform-body">
          <p className="nv-pform-intro">小围按你的权限和你选的模型执行；写操作发给你确认后才做。</p>
          <label className="nv-pfield" htmlFor={`${uid}-n`}>
            <span className="nv-pfield-label">名称</span>
            <input id={`${uid}-n`} className="input" value={f.name} maxLength={60} placeholder="例如：逾期需求提醒" onChange={(e) => set({ name: e.target.value })} required />
          </label>
          <div className="nv-pfield">
            <span className="nv-pfield-label" id={`${uid}-w`}>
              什么时候
            </span>
            <div className="nv-pform-seg nv-ftab-seg" role="group" aria-labelledby={`${uid}-w`}>
              <button type="button" aria-pressed={f.triggerType === "event"} onClick={() => set({ triggerType: "event" })}>
                系统事件
              </button>
              <button type="button" aria-pressed={f.triggerType === "schedule"} onClick={() => set({ triggerType: "schedule" })}>
                定时
              </button>
            </div>
          </div>
          {f.triggerType === "event" ? (
            <>
              <label className="nv-pfield" htmlFor={`${uid}-e`}>
                <span className="nv-pfield-label">事件</span>
                <select id={`${uid}-e`} className="input" value={f.event || ""} onChange={(e) => set({ event: e.target.value, eventStatus: null })}>
                  {data.events.map((ev) => (
                    <option key={ev.key} value={ev.key}>
                      {ev.label}
                    </option>
                  ))}
                </select>
              </label>
              {statusOptions ? (
                <label className="nv-pfield" htmlFor={`${uid}-s`}>
                  <span className="nv-pfield-label">只在变成这个状态时</span>
                  <select id={`${uid}-s`} className="input" value={f.eventStatus || ""} onChange={(e) => set({ eventStatus: e.target.value || null })}>
                    <option value="">任何状态</option>
                    {statusOptions.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          ) : (
            <div className="nv-agt-grid">
              <label className="nv-pfield" htmlFor={`${uid}-f`}>
                <span className="nv-pfield-label">频率</span>
                <select id={`${uid}-f`} className="input" value={f.freq || "daily"} onChange={(e) => set({ freq: e.target.value })}>
                  {data.freqs.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
              {f.freq === "weekly" ? (
                <label className="nv-pfield" htmlFor={`${uid}-d`}>
                  <span className="nv-pfield-label">星期</span>
                  <select id={`${uid}-d`} className="input" value={f.weekday || 1} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                    {WEEK.map((w, i) => (
                      <option key={w} value={i + 1}>
                        {w}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="nv-pfield" htmlFor={`${uid}-t`}>
                <span className="nv-pfield-label">时间（服务器时间）</span>
                <input id={`${uid}-t`} type="time" className="input" value={f.time || ""} onChange={(e) => set({ time: e.target.value })} required />
              </label>
            </div>
          )}
          <label className="nv-pfield" htmlFor={`${uid}-p`}>
            <span className="nv-pfield-label">范围</span>
            <select id={`${uid}-p`} className="input" value={f.projectId || ""} onChange={(e) => set({ projectId: e.target.value || null })}>
              <option value="">全部项目（我能看到的）</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  项目：{p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="nv-pfield" htmlFor={`${uid}-q`}>
            <span className="nv-pfield-label">让小围做什么</span>
            <textarea id={`${uid}-q`} className="input" rows={4} maxLength={2000} value={f.prompt} placeholder="例如：把计划完成已过、还没上线的需求列出来，在每条需求下评论提醒负责人；同一条需求一天只提醒一次。" onChange={(e) => set({ prompt: e.target.value })} required />
          </label>
          <label className="nv-pfield" htmlFor={`${uid}-m`}>
            <span className="nv-pfield-label">模型</span>
            <select
              id={`${uid}-m`}
              className="input"
              value={modelKey}
              onChange={(e) => {
                const [credentialId, ...rest] = e.target.value.split("|");
                set({ credentialId, model: rest.join("|") });
              }}
            >
              {!modelKey ? <option value="">请选择模型</option> : null}
              {models.map((m) => (
                <option key={`${m.credentialId}|${m.model}`} value={`${m.credentialId}|${m.model}`} disabled={m.disabled}>
                  {m.label}
                  {m.disabled ? `（${m.reason || "不可用"}）` : ""}
                </option>
              ))}
            </select>
          </label>
          {!models.length ? (
            <p className="nv-set-hint">
              还没有可用的模型，先到 <Link href="/settings/models">设置 · 模型管理</Link> 添加。
            </p>
          ) : null}
          <p className="nv-set-hint">
            {f.triggerType === "event"
              ? "事件内容会作为资料交给小围（标题、状态、操作人），不会当成指令。小围自己的操作引起的事件也会触发别的规则，连锁超过 5 层自动停止。"
              : "写操作（新建、修改、评论）一律等你确认；等确认时会发站内通知，订阅了飞书机器人也会收到卡片。"}
          </p>
        </div>
        <div className="nv-pform-foot">
          <span className="nv-pform-note" />
          <ModalCancelButton />
          <button type="submit" className="btn-primary" disabled={busy || !f.name.trim() || !f.prompt.trim() || !modelKey}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}
