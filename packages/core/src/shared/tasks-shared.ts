/** 需求任务（T43）：前后端共用（客户端也引用，不要引 prisma） */
export const TASK_KINDS = ["design", "frontend", "backend", "dev", "test", "release", "other"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const TASK_KIND_LABEL: Record<TaskKind, string> = { design: "设计", frontend: "前端", backend: "后端", dev: "开发", test: "测试", release: "发布", other: "其他" };

export const TASK_STATUSES = ["todo", "doing", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { todo: "待办", doing: "进行中", done: "已完成", cancelled: "已取消" };

export const isTaskKind = (v: unknown): v is TaskKind => typeof v === "string" && (TASK_KINDS as readonly string[]).includes(v);
export const isTaskStatus = (v: unknown): v is TaskStatus => typeof v === "string" && (TASK_STATUSES as readonly string[]).includes(v);
