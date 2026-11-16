/** 系统设置的类型与常量（前后端共用，不能引入 prisma） */
export type SystemSettings = { name: string; logo: string; timezone: string; weekStart: "1" | "0" };

export const DEFAULT_SETTINGS: SystemSettings = { name: "小围空间", logo: "", timezone: "Asia/Shanghai", weekStart: "1" };

export const TIMEZONES = [
  { value: "Asia/Shanghai", label: "(UTC+08:00) 北京" },
  { value: "Asia/Hong_Kong", label: "(UTC+08:00) 香港" },
  { value: "Asia/Singapore", label: "(UTC+08:00) 新加坡" },
  { value: "Asia/Tokyo", label: "(UTC+09:00) 东京" },
  { value: "Europe/London", label: "(UTC+00:00) 伦敦" },
  { value: "Europe/Berlin", label: "(UTC+01:00) 柏林" },
  { value: "America/New_York", label: "(UTC-05:00) 纽约" },
  { value: "America/Edmonton", label: "(UTC-07:00) 埃德蒙顿" },
  { value: "America/Los_Angeles", label: "(UTC-08:00) 洛杉矶" },
  { value: "UTC", label: "(UTC+00:00) 协调世界时" },
] as const;

