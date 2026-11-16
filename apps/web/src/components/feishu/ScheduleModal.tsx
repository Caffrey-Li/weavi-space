"use client";

import { useId, useState } from "react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { SCHEDULE_KINDS, WEEKDAY_LABELS } from "@/lib/schedules-shared";

export type ScheduleRow = { id: string; name: string; kind: string; message: string | null; time: string; weekdays: string; channel: string; enabled: boolean; lastRunAt: string | null; lastStatus: string | null };

const CHANNELS = [
  { key: "both", label: "群机器人 + 飞书私信" },
  { key: "webhook", label: "只发群机器人" },
  { key: "dm", label: "只发飞书私信" },
];

/** Figma 40：新建 / 编辑定时任务 */
export function ScheduleModal({ row, onClose, onSaved }: { row: ScheduleRow | null; onClose: () => void; onSaved: (name: string) => void }) {
  const baseId = useId();
  const [name, setName] = useState(row?.name || "每日待办摘要");
  const [kind, setKind] = useState(row?.kind || "digest");
  const [message, setMessage] = useState(row?.message || "");
  const [time, setTime] = useState(row?.time || "09:00");
  const [days, setDays] = useState<number[]>(row ? row.weekdays.split(",").map(Number).filter(Boolean) : [1, 2, 3, 4, 5]);
  const [channel, setChannel] = useState(row?.channel || "both");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const kindInfo = SCHEDULE_KINDS.find((k) => k.key === kind);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const body = { name, kind, message, time, weekdays: days, channel };
    const res = await fetch(row ? `/api/me/schedules/${row.id}` : "/api/me/schedules", { method: row ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(d.error || "保存失败");
    onSaved(name.trim());
  }

  return (
    <Modal open onClose={onClose} title={row ? "编辑定时任务" : "新建定时任务"} dirty={!row} busy={busy} panelClassName="nv-prod-modal nv-bot-modal">
      <form onSubmit={submit} className="nv-pform" noValidate>
        <p className="nv-pform-intro">到点后把内容发到你在「发送渠道」里开启的机器人。</p>
        <div className="nv-pform-body">
          {error ? (
            <div role="alert" className="banner-error" tabIndex={-1}>
              {error}
            </div>
          ) : null}
          <label className="nv-pfield" htmlFor={`${baseId}-name`}>
            <span className="nv-pfield-label">名称</span>
            <input id={`${baseId}-name`} className="input" value={name} maxLength={40} data-initial-focus="" onChange={(e) => setName(e.target.value)} />
          </label>
          <fieldset className="nv-pfield">
            <legend className="nv-pfield-label">发送内容</legend>
            <div className="nv-bot-radios">
              {SCHEDULE_KINDS.map((k) => (
                <label key={k.key} className="nv-bot-radio">
                  <input
                    type="radio"
                    name={`${baseId}-kind`}
                    checked={kind === k.key}
                    onChange={() => {
                      setKind(k.key);
                      if (!row && SCHEDULE_KINDS.some((x) => x.label === name)) setName(k.label === "自定义消息" ? "提醒" : k.label);
                    }}
                  />
                  {k.label}
                </label>
              ))}
            </div>
            <span className="nv-set-hint">{kindInfo?.hint}</span>
            {kind === "text" ? (
              <textarea className="input nv-pfield-textarea" value={message} maxLength={1000} placeholder="例如：记得更新本周进展" onChange={(e) => setMessage(e.target.value)} />
            ) : null}
          </fieldset>
          <div className="nv-ftab-two">
            <label className="nv-pfield" htmlFor={`${baseId}-time`}>
              <span className="nv-pfield-label">发送时间</span>
              <input id={`${baseId}-time`} className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label className="nv-pfield" htmlFor={`${baseId}-ch`}>
              <span className="nv-pfield-label">发送到</span>
              <select id={`${baseId}-ch`} className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
                {CHANNELS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="nv-pfield">
            <legend className="nv-pfield-label">重复</legend>
            <div className="nv-bot-days">
              {WEEKDAY_LABELS.map((d, i) => {
                const n = i + 1;
                const on = days.includes(n);
                return (
                  <button
                    key={d}
                    type="button"
                    className={`${on ? "btn-primary" : "btn-secondary"} nv-head-btn`}
                    aria-pressed={on}
                    aria-label={`周${d}`}
                    onClick={() => setDays((list) => (on ? list.filter((x) => x !== n) : [...list, n]))}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <span className="nv-set-hint">时间按北京时间计算；全部不选表示每天</span>
          </fieldset>
        </div>
        <div className="nv-pform-foot">
          <span className="nv-pform-note">创建后可在列表里随时暂停</span>
          <ModalCancelButton className="btn-secondary nv-head-btn" />
          <button type="submit" className="btn-primary nv-head-btn" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "保存中…" : row ? "保存" : "创建"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
