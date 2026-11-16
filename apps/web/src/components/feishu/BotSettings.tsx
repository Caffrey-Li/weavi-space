"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { CircleAlert, CircleCheck, Plus } from "lucide-react";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { describeSchedule } from "@/lib/schedules-shared";
import { ScheduleModal, type ScheduleRow } from "./ScheduleModal";

type View = {
  webhookMasked: string;
  secretSet: boolean;
  webhookOn: boolean;
  dmOn: boolean;
  events: string[];
  eventOptions: { key: string; label: string; hint: string }[];
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
  feishuBound: boolean;
  name: string;
  appReady: boolean;
};

function stamp(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="nv-switch nv-bot-switch">
      <input type="checkbox" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" />
    </label>
  );
}

/** Figma 39：发送渠道（群机器人 Webhook / 飞书私信）→ 消息通知 → 定时任务 */
export function BotSettings() {
  const toast = useToast();
  const confirm = useConfirm();
  const baseId = useId();
  const [view, setView] = useState<View | null>(null);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [webhook, setWebhook] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<ScheduleRow | "new" | null>(null);

  const load = useCallback(async () => {
    const [b, s] = await Promise.all([fetch("/api/me/bot", { cache: "no-store" }), fetch("/api/me/schedules", { cache: "no-store" })]);
    const bd = await b.json().catch(() => ({}));
    if (b.ok) setView(bd as View);
    else setErr(bd.error || "读取失败");
    const sd = await s.json().catch(() => ({}));
    if (s.ok) setSchedules((sd.schedules || []) as ScheduleRow[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function put(body: Record<string, unknown>, okMsg?: string) {
    const res = await fetch("/api/me/bot", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(d.error || "保存失败");
      return false;
    }
    setView(d as View);
    if (okMsg) toast.success(okMsg);
    return true;
  }

  async function saveWebhook() {
    if (!webhook.trim() && !secret.trim()) return toast.error(view?.webhookMasked ? "没有改动" : "请填写 Webhook 地址");
    setSaving(true);
    const ok = await put({ ...(webhook.trim() ? { webhookUrl: webhook.trim() } : {}), ...(secret.trim() ? { secret: secret.trim() } : {}), webhookOn: true }, "已加密保存群机器人设置");
    setSaving(false);
    if (ok) {
      setWebhook("");
      setSecret("");
    }
  }

  async function test() {
    setTesting(true);
    const res = await fetch("/api/me/bot/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const d = await res.json().catch(() => ({}));
    setTesting(false);
    if (!res.ok) toast.error(d.error || "发送失败");
    else toast.success("测试消息已发送，去飞书看看");
    void load();
  }

  async function toggleSchedule(s: ScheduleRow, enabled: boolean) {
    setSchedules((list) => list.map((x) => (x.id === s.id ? { ...x, enabled } : x)));
    const res = await fetch(`/api/me/schedules/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
    if (!res.ok) {
      toast.error("保存失败");
      void load();
    }
  }
  async function runNow(s: ScheduleRow) {
    const res = await fetch(`/api/me/schedules/${s.id}/run`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) toast.error(d.error || "发送失败");
    else toast.success(`已发送「${s.name}」`);
    void load();
  }
  async function removeSchedule(s: ScheduleRow) {
    const ok = await confirm({ title: `删除定时任务「${s.name}」？`, body: "删除后不再发送。", confirmLabel: "删除", tone: "danger" });
    if (!ok) return;
    await fetch(`/api/me/schedules/${s.id}`, { method: "DELETE" });
    toast.success("已删除");
    void load();
  }

  if (!view) return <div className="nv-set">{err ? <p className="nv-set-error">{err}</p> : <p className="nv-set-hint">正在读取…</p>}</div>;

  const testLine = view.lastTestAt ? `${stamp(view.lastTestAt)} 测试消息${view.lastTestOk ? "发送成功" : "发送失败"}` : view.lastError ? `上次发送失败：${view.lastError}` : "保存后可发送一条测试消息";

  return (
    <div className="nv-set nv-bot">
      <section className="nv-set-section" aria-labelledby={`${baseId}-ch`}>
        <header>
          <h2 id={`${baseId}-ch`}>发送渠道</h2>
          <p>通知和定时任务通过下面的渠道发给你，两个渠道可以同时开启。</p>
        </header>
        <div className="nv-bot-box">
          <div className="nv-bot-ch">
            <div className="nv-bot-ch-head">
              <div className="min-w-0 flex-1">
                <p className="nv-bot-title">群机器人 Webhook</p>
                <p className="nv-set-hint">在飞书或 Lark 群里添加「自定义机器人」，复制 Webhook 地址；开启了签名校验就一并填入密钥。</p>
              </div>
              <Switch checked={view.webhookOn} label="开启群机器人" onChange={(v) => void put({ webhookOn: v }, v ? "已开启群机器人" : "已关闭群机器人")} disabled={!view.webhookMasked && !webhook} />
            </div>
            <div className="nv-set-grid">
              <label className="nv-set-field">
                Webhook 地址
                <input
                  className="input"
                  value={webhook}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={view.webhookMasked || "https://open.feishu.cn/open-apis/bot/v2/hook/…"}
                  onChange={(e) => setWebhook(e.target.value)}
                />
              </label>
              <label className="nv-set-field">
                签名校验密钥
                <input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={view.secretSet ? "已加密保存，留空则保持不变" : "没开启签名校验可不填"} autoComplete="new-password" />
              </label>
            </div>
            <div className="nv-bot-ops">
              {view.lastTestAt && view.lastTestOk ? <CircleCheck size={14} className="nv-itr-ok" aria-hidden="true" /> : view.lastError ? <CircleAlert size={14} className="nv-itr-bad" aria-hidden="true" /> : null}
              <span className="nv-set-hint flex-1" title={view.lastError || undefined}>
                {testLine}
              </span>
              <button type="button" className="btn-secondary nv-head-btn" disabled={testing || (!view.webhookOn && !view.dmOn)} onClick={() => void test()}>
                {testing ? "发送中…" : "发送测试"}
              </button>
              <button type="button" className="btn-primary nv-head-btn" disabled={saving} onClick={() => void saveWebhook()}>
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
          <div className="nv-bot-ch">
            <div className="nv-bot-ch-head">
              <div className="min-w-0 flex-1">
                <p className="nv-bot-title">飞书私信</p>
                <p className="nv-set-hint">
                  {view.appReady ? "由企业的飞书应用直接私信你，需要账号用飞书登录过一次。" : "管理员还没有配置飞书应用（系统设置 › 飞书登录），暂不能私信。"}
                </p>
              </div>
              {view.feishuBound ? <span className="nv-tag is-dot is-success">已绑定 {view.name}</span> : <span className="nv-tag is-dot is-neutral">未绑定飞书账号</span>}
              <Switch checked={view.dmOn} label="开启飞书私信" disabled={!view.feishuBound || !view.appReady} onChange={(v) => void put({ dmOn: v }, v ? "已开启飞书私信" : "已关闭飞书私信")} />
            </div>
          </div>
        </div>
      </section>

      <section className="nv-set-section" aria-labelledby={`${baseId}-ev`}>
        <header>
          <h2 id={`${baseId}-ev`}>消息通知</h2>
          <p>选择哪些变化要通知你。你自己做的改动不会通知自己。</p>
        </header>
        <ul className="nv-bot-box nv-bot-events">
          {view.eventOptions.map((e) => {
            const on = view.events.includes(e.key);
            return (
              <li key={e.key}>
                <label className="nv-ftab-check">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => void put({ events: on ? view.events.filter((k) => k !== e.key) : [...view.events, e.key] })}
                  />
                  {e.label}
                </label>
                <span className="nv-set-hint">{e.hint}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="nv-set-section" aria-labelledby={`${baseId}-sc`}>
        <header className="nv-bot-sec-head">
          <div>
            <h2 id={`${baseId}-sc`}>定时任务</h2>
            <p>按设定时间把摘要或提醒发到你的渠道。</p>
          </div>
          <button type="button" className="btn-secondary nv-head-btn" onClick={() => setEdit("new")}>
            <Plus size={14} aria-hidden="true" />
            新建定时任务
          </button>
        </header>
        {schedules.length === 0 ? (
          <p className="nv-itr-empty">还没有定时任务。可以建一个「每日待办摘要」，每个工作日早上发给你。</p>
        ) : (
          <ul className="nv-bot-box nv-bot-sched">
            {schedules.map((s) => (
              <li key={s.id}>
                <Switch checked={s.enabled} label={`${s.enabled ? "暂停" : "启用"}「${s.name}」`} onChange={(v) => void toggleSchedule(s, v)} />
                <div className="min-w-0 flex-1">
                  <p className="nv-bot-name">{s.name}</p>
                  <p className="nv-set-hint">
                    {describeSchedule(s)}
                    {s.kind === "text" && s.message ? ` · 自定义消息「${s.message.slice(0, 20)}」` : ""}
                    {s.lastRunAt ? ` · 上次 ${stamp(s.lastRunAt)} ${s.lastStatus || ""}` : ""}
                  </p>
                </div>
                <ActionMenu
                  label={`${s.name} 的更多操作`}
                  items={[
                    { label: "编辑", onSelect: () => setEdit(s) },
                    { label: "立即发送一次", onSelect: () => void runNow(s) },
                    { label: "删除", tone: "danger", onSelect: () => void removeSchedule(s) },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {edit ? (
        <ScheduleModal
          row={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={(name) => {
            setEdit(null);
            toast.success(edit === "new" ? `已创建「${name}」` : "已保存");
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
