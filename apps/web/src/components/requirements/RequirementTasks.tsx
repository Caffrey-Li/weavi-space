"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Wand2 } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { fmtDate } from "@/lib/utils";
import { TASK_KINDS, TASK_KIND_LABEL, TASK_STATUSES, TASK_STATUS_LABEL, type TaskKind, type TaskStatus } from "@pm-collab/core/shared/tasks-shared";

export type TaskItem = {
  id: string;
  code: string;
  kind: TaskKind;
  title: string;
  status: TaskStatus;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
  startAt: string | null;
  dueAt: string | null;
  estimate: number | null;
};
type Span = { count: number; done: number; start: string | null; due: string | null };
export type PlanData = {
  dev: Span;
  test: Span;
  release: { id: string; version: string; plannedAt: string | null; released: boolean } | null;
  conflict: { latest: string; next: { id: string; version: string; plannedAt: string | null } | null } | null;
  children: number;
  canEdit: boolean;
};

const md = (v: string | null) => (v ? fmtDate(v).slice(5) : "");
const range = (s: Span) => (s.start || s.due ? `${md(s.start) || "?"} → ${md(s.due) || "?"}` : "未排期");
const day = (v: string | null) => (v ? v.slice(0, 10) : "");

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "操作失败");
  return d;
}

/** 需求详情 · 计划 + 任务（T43，Figma 89A） */
export function RequirementTasks({
  id,
  tasks,
  plan,
  canEdit,
  me,
  members,
  designStage,
}: {
  id: string;
  tasks: TaskItem[];
  plan: PlanData;
  canEdit: boolean;
  me: string;
  members: { id: string; name: string }[];
  designStage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<TaskItem | "new" | null>(null);
  const [gen, setGen] = useState(false);
  const done = tasks.filter((t) => t.status === "done").length;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const setStatus = (t: TaskItem, status: TaskStatus) => run(() => call(`/api/requirements/${id}/tasks/${t.id}`, "PATCH", { status }), `${t.code} 已改为「${TASK_STATUS_LABEL[status]}」`);
  const move = () =>
    plan.conflict?.next &&
    run(() => call(`/api/requirements/${id}/tasks`, "POST", { action: "moveRelease", releaseId: plan.conflict!.next!.id }), `已挪到发版 ${plan.conflict.next.version}`);

  return (
    <>
      <section className="nv-plan" aria-labelledby="rq-plan-title">
        <div className="nv-ra-head">
          <h2 id="rq-plan-title">计划</h2>
          <span className="nv-flow-meta">跟随任务和子需求自动汇总</span>
        </div>
        <div className="nv-plan-cards">
          <div className="nv-plan-card">
            <span>开发计划</span>
            <b>{range(plan.dev)}</b>
            <small>{plan.dev.count ? `设计 / 开发任务 ${plan.dev.count} 个，完成 ${plan.dev.done}` : "还没有开发任务"}</small>
          </div>
          <div className="nv-plan-card">
            <span>测试计划</span>
            <b>{range(plan.test)}</b>
            <small>{plan.test.count ? `测试任务 ${plan.test.count} 个，完成 ${plan.test.done}` : "还没有测试任务"}</small>
          </div>
          <div className={`nv-plan-card${plan.conflict ? " is-warn" : ""}`}>
            <span>发布计划</span>
            <b>{plan.release ? `${plan.release.version}${plan.release.plannedAt ? ` · ${md(plan.release.plannedAt)} 上线` : ""}` : "未加入发版"}</b>
            <small>{plan.release?.released ? "已上线" : plan.conflict ? `计划最晚到 ${md(plan.conflict.latest)}，晚于上线日` : plan.release ? "按计划可以赶上" : "在属性面板「发版」里选择"}</small>
          </div>
        </div>
        {plan.conflict ? (
          <p className="nv-plan-warn" role="note">
            <span>
              计划最晚到 {md(plan.conflict.latest)}，晚于所在发版 {plan.release?.version} 的上线日 {md(plan.release?.plannedAt ?? null)}。
            </span>
            {plan.canEdit && plan.conflict.next ? (
              <button type="button" className="btn-primary nv-head-btn" onClick={() => void move()}>
                {plan.children ? `连同 ${plan.children} 条子需求` : ""}挪到 {plan.conflict.next.version}
                {plan.conflict.next.plannedAt ? `（${md(plan.conflict.next.plannedAt)}）` : ""}
              </button>
            ) : (
              <span className="nv-flow-meta">没有更晚的待上线发版，可以先新建一期</span>
            )}
          </p>
        ) : null}
      </section>
      <section className="nv-plan" aria-labelledby="rq-tasks-title" id="rq-tasks">
        <div className="nv-ra-head">
          <h2 id="rq-tasks-title">
            任务<span className="nv-count">{tasks.length}</span>
          </h2>
          {tasks.length ? <span className="nv-flow-meta">完成 {done}</span> : null}
          <span className="nv-ra-spacer" />
          {canEdit ? (
            <>
              <button type="button" className="btn-secondary nv-head-btn" onClick={() => setGen(true)}>
                <Wand2 size={14} aria-hidden="true" />
                按模板生成
              </button>
              <button type="button" className="btn-secondary nv-head-btn" onClick={() => setEdit("new")}>
                <Plus size={14} aria-hidden="true" />
                添加任务
              </button>
            </>
          ) : null}
        </div>
        {tasks.length ? (
          <div className="card overflow-x-auto">
            <table className="table-compact w-full min-w-[640px] nv-task-table">
              <thead>
                <tr>
                  <th className="w-[72px]">编号</th>
                  <th className="w-[64px]">类型</th>
                  <th>任务</th>
                  <th className="w-[84px]">负责人</th>
                  <th className="w-[112px]">计划</th>
                  <th className="w-[108px]">状态</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td className="nv-mono">{t.code}</td>
                    <td>
                      <span className="nv-task-kind" data-kind={t.kind}>
                        {TASK_KIND_LABEL[t.kind]}
                      </span>
                    </td>
                    <td className="cell-title" title={t.title}>
                      {canEdit ? (
                        <button type="button" className="nv-task-title" onClick={() => setEdit(t)}>
                          {t.title}
                        </button>
                      ) : (
                        t.title
                      )}
                    </td>
                    <td>{t.assignee?.name || <span className="nv-flow-meta">未指派</span>}</td>
                    <td>{t.startAt || t.dueAt ? `${md(t.startAt) || "?"} → ${md(t.dueAt) || "?"}` : <span className="nv-flow-meta">—</span>}</td>
                    <td>
                      {canEdit || t.assignee?.id === me ? (
                        <select className="input nv-task-status" data-status={t.status} value={t.status} aria-label={`${t.code} 状态`} onChange={(e) => void setStatus(t, e.target.value as TaskStatus)}>
                          {TASK_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {TASK_STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="nv-task-status" data-status={t.status}>
                          {TASK_STATUS_LABEL[t.status]}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="nv-ra-empty">还没有任务。可以「按模板生成」前端 / 后端 / 测试 / 发布任务，日期按需求的开始和截止切分；分支名和提交说明里写上任务编号，接入 GitLab 后会自动关联。</p>
        )}
        <p className="nv-ra-note">开发任务（前端 / 后端 / 开发）全部完成，需求自动进入「开发完成」；测试任务全部完成，进入「测试完成」。改需求的开始或截止日期时，没开始的任务一起平移。</p>
      </section>
      {edit ? (
        <TaskModal
          id={id}
          task={edit === "new" ? null : edit}
          members={members}
          onClose={() => setEdit(null)}
          onDone={() => (setEdit(null), router.refresh())}
          onDelete={
            edit !== "new"
              ? async () => {
                  if (await confirm({ title: `删除 ${edit.code}？`, body: "删除后不能恢复。", confirmLabel: "删除", tone: "danger" })) {
                    await run(() => call(`/api/requirements/${id}/tasks/${edit.id}`, "DELETE"), "已删除");
                    setEdit(null);
                  }
                }
              : undefined
          }
        />
      ) : null}
      {gen ? <GenerateModal id={id} designStage={designStage} onClose={() => setGen(false)} onDone={() => (setGen(false), router.refresh())} /> : null}
    </>
  );
}

function TaskModal({ id, task, members, onClose, onDone, onDelete }: { id: string; task: TaskItem | null; members: { id: string; name: string }[]; onClose: () => void; onDone: () => void; onDelete?: () => Promise<void> }) {
  const toast = useToast();
  const [v, setV] = useState({
    kind: task?.kind || ("frontend" as TaskKind),
    title: task?.title || "",
    assigneeId: task?.assignee?.id || "",
    startAt: day(task?.startAt ?? null),
    dueAt: day(task?.dueAt ?? null),
    estimate: task?.estimate != null ? String(task.estimate) : "",
    status: task?.status || ("todo" as TaskStatus),
  });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const submit = async () => {
    setBusy(true);
    try {
      const body = { ...v, assigneeId: v.assigneeId || null, startAt: v.startAt || null, dueAt: v.dueAt || null, estimate: v.estimate === "" ? null : v.estimate };
      if (task) await call(`/api/requirements/${id}/tasks/${task.id}`, "PATCH", body);
      else await call(`/api/requirements/${id}/tasks`, "POST", { action: "create", ...body });
      toast.success(task ? "已保存" : "已添加任务");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={task ? `编辑 ${task.code}` : "添加任务"} busy={busy} dirty={!task && !!v.title}>
      <div className="nv-ra-form">
        <div className="nv-ra-field">
          <span className="nv-ra-label" id="tk-kind">
            类型
          </span>
          <div className="nv-ra-seg" role="radiogroup" aria-labelledby="tk-kind">
            {TASK_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={v.kind === k} className={v.kind === k ? "is-on" : ""} onClick={() => set({ kind: k })}>
                {TASK_KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <label className="nv-ra-field">
          <span className="nv-ra-label">任务</span>
          <input className="input" value={v.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} autoFocus />
        </label>
        <div className="nv-task-grid">
          <label className="nv-ra-field">
            <span className="nv-ra-label">负责人</span>
            <select className="input" value={v.assigneeId} onChange={(e) => set({ assigneeId: e.target.value })}>
              <option value="">未指派</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="nv-ra-field">
            <span className="nv-ra-label">状态</span>
            <select className="input" value={v.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="nv-ra-field">
            <span className="nv-ra-label">开始</span>
            <input className="input" type="date" value={v.startAt} onChange={(e) => set({ startAt: e.target.value })} />
          </label>
          <label className="nv-ra-field">
            <span className="nv-ra-label">截止</span>
            <input className="input" type="date" value={v.dueAt} onChange={(e) => set({ dueAt: e.target.value })} />
          </label>
          <label className="nv-ra-field">
            <span className="nv-ra-label">预估工时（小时）</span>
            <input className="input" inputMode="decimal" value={v.estimate} onChange={(e) => set({ estimate: e.target.value })} />
          </label>
        </div>
      </div>
      <div className="nv-pform-foot">
        {onDelete ? (
          <button type="button" className="btn-secondary nv-head-btn" onClick={() => void onDelete()}>
            删除
          </button>
        ) : null}
        <span className="nv-pform-note" />
        <ModalCancelButton className="btn-secondary nv-head-btn" />
        <button type="button" className="btn-primary nv-head-btn" disabled={busy || !v.title.trim()} onClick={() => void submit()}>
          {busy ? "正在保存…" : task ? "保存" : "添加"}
        </button>
      </div>
    </Modal>
  );
}

function GenerateModal({ id, designStage, onClose, onDone }: { id: string; designStage: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [kinds, setKinds] = useState<TaskKind[]>(designStage ? ["design", "frontend", "backend", "test", "release"] : ["frontend", "backend", "test", "release"]);
  const [busy, setBusy] = useState(false);
  const toggle = (k: TaskKind) => setKinds((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));
  const submit = async () => {
    setBusy(true);
    try {
      const d = await call(`/api/requirements/${id}/tasks`, "POST", { action: "generate", kinds });
      toast.success(d.created ? `已生成 ${d.created} 个任务` : "这些类型的任务已经有了");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="按模板生成任务" busy={busy}>
      <div className="nv-ra-form">
        <p className="nv-ra-tip">每种类型生成一个任务，已经有的类型跳过。日期按需求的开始—截止切分：设计在前 20%，开发到 60%，测试到 90%，发布在截止日。没有日期时留空。</p>
        <div className="nv-ra-seg">
          {(["design", "frontend", "backend", "dev", "test", "release"] as TaskKind[]).map((k) => (
            <button key={k} type="button" aria-pressed={kinds.includes(k)} className={kinds.includes(k) ? "is-on" : ""} onClick={() => toggle(k)}>
              {TASK_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="nv-pform-foot">
        <span className="nv-pform-note" />
        <ModalCancelButton className="btn-secondary nv-head-btn" />
        <button type="button" className="btn-primary nv-head-btn" disabled={busy || !kinds.length} onClick={() => void submit()}>
          生成 {kinds.length} 个
        </button>
      </div>
    </Modal>
  );
}
