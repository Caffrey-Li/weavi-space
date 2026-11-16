/** 定时任务的常量和校验：客户端组件也会用到，不能引入 prisma */
export const SCHEDULE_KINDS = [
  { key: "digest", label: "我的待办摘要", hint: "汇总指派给你、未完成的需求和 Bug，逾期和临近到期的排在前面" },
  { key: "plans", label: "上线计划进度", hint: "你所在项目里未上线的计划，按计划日期列出完成情况" },
  { key: "text", label: "自定义消息", hint: "到点发送你填写的文字，适合周报、站会提醒" },
] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number]["key"];
export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
export function describeSchedule(s: { time: string; weekdays: string; channel: string }) {
  const days = s.weekdays.split(",").map(Number).filter((n) => n >= 1 && n <= 7);
  let when = "每天";
  if (days.length && days.length < 7) {
    const key = days.join(",");
    if (key === "1,2,3,4,5") when = "工作日";
    else if (key === "6,7") when = "周末";
    else when = `每周${days.map((d) => WEEKDAY_LABELS[d - 1]).join("、")}`;
  }
  const ch = s.channel === "webhook" ? "群机器人" : s.channel === "dm" ? "私信" : "群机器人、私信";
  return `${when} ${s.time} · ${ch}`;
}

export type ScheduleInput = { name?: string; kind?: string; message?: string; time?: string; weekdays?: number[]; channel?: string; enabled?: boolean };

export function cleanSchedule(b: ScheduleInput, partial = false) {
  const data: Record<string, unknown> = {};
  if (!partial || b.name !== undefined) {
    const name = (b.name || "").trim();
    if (!name) throw new Error("请填写名称");
    data.name = name.slice(0, 40);
  }
  if (!partial || b.kind !== undefined) {
    if (!SCHEDULE_KINDS.some((k) => k.key === b.kind)) throw new Error("请选择发送内容");
    data.kind = b.kind;
  }
  if (b.message !== undefined || (!partial && b.kind === "text")) {
    const m = (b.message || "").trim();
    if ((b.kind ?? "text") === "text" && !m && !partial) throw new Error("请填写要发送的消息");
    data.message = m.slice(0, 1000) || null;
  }
  if (!partial || b.time !== undefined) {
    const m = (b.time || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error("发送时间格式应为 09:00");
    data.time = `${m[1].padStart(2, "0")}:${m[2]}`;
  }
  if (!partial || b.weekdays !== undefined) data.weekdays = Array.from(new Set((b.weekdays || []).filter((d) => d >= 1 && d <= 7))).sort().join(",");
  if (!partial || b.channel !== undefined) {
    if (!["webhook", "dm", "both"].includes(b.channel || "")) throw new Error("请选择发送到哪里");
    data.channel = b.channel;
  }
  if (b.enabled !== undefined) data.enabled = Boolean(b.enabled);
  return data;
}

