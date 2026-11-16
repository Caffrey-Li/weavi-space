export const BRAND = "#0066CC";

/**
 * 角色（User.globalRole）的中文名：决定功能权限与数据范围。
 * 内置四个；自定义角色的名称来自 roles 表，由 registerLabels() 在运行时补进来。
 */
export const ROLE_LABELS: Record<string, string> = {
  admin: "系统管理员",
  manager: "管理者",
  member: "成员",
  guest: "访客",
};

/**
 * 岗位（User.position / ProjectMember.role）的中文名：项目 / 产品中的职责，不决定权限。
 * 自定义岗位的名称来自 positions 表，由 registerLabels() 补进来。
 */
export const POSITION_LABELS: Record<string, string> = {
  pm: "项目经理",
  product: "产品经理",
  tech_lead: "技术负责人",
  frontend: "前端开发",
  backend: "后端开发",
  qa: "测试",
  business: "业务",
};

/** 兼容旧名：岗位标签 */
export const JOB_ROLE_LABELS = POSITION_LABELS;

/** 用数据库里的角色 / 岗位名称覆盖默认名称（AppShell 渲染时调用） */
export function registerLabels(opts: { roles?: { key: string; name: string }[]; positions?: { key: string; name: string }[] }) {
  for (const r of opts.roles || []) ROLE_LABELS[r.key] = r.name;
  for (const p of opts.positions || []) POSITION_LABELS[p.key] = p.name;
}

export function roleLabel(role: string | null | undefined) {
  if (!role) return "成员";
  return ROLE_LABELS[role] || role;
}

/** 内置岗位的顺序（自定义岗位排在后面） */
export const JOB_ROLE_OPTIONS = ["pm", "product", "tech_lead", "frontend", "backend", "qa"] as const;

/** 研发项目通常需要的岗位：用于项目概览「团队构成」提示缺口 */
export const CORE_TEAM_ROLES = ["pm", "product", "frontend", "backend", "qa"] as const;

/** 需求负责人岗位槽位：按岗位从项目成员中优选 */
export const REQUIREMENT_ASSIGNEE_SLOTS = [
  { key: "product", formKey: "productId", label: "产品负责人", preferRoles: ["product", "pm"] },
  { key: "frontend", formKey: "frontendId", label: "前端负责人", preferRoles: ["frontend"] },
  { key: "backend", formKey: "backendId", label: "后端负责人", preferRoles: ["backend", "tech_lead"] },
  { key: "qa", formKey: "qaId", label: "测试负责人", preferRoles: ["qa"] },
] as const;

export type AssigneeSlotKey = (typeof REQUIREMENT_ASSIGNEE_SLOTS)[number]["key"];

/** RequirementAssignee.role 的中文名（槽位，不是人员岗位） */
export const ASSIGNEE_ROLE_LABELS: Record<string, string> = {
  product: "产品负责人",
  frontend: "前端负责人",
  backend: "后端负责人",
  qa: "测试负责人",
  owner: "负责人",
};

/** Bug 负责人优选岗位 */
export const BUG_ASSIGNEE_PREFER_ROLES = ["frontend", "backend", "tech_lead", "qa"] as const;

export function jobRoleLabel(role: string | null | undefined) {
  if (!role || role === "member") return "未设置岗位";
  return POSITION_LABELS[role] || role;
}

/**
 * 需求状态（阶段子状态）。key 是存库的英文标识（11-06 起，之前存的是中文名），label 是界面文字。
 * color 取自 Clarity 语义色（tokens.css 的 state-* 前景色），避免高饱和实色。
 * 看板列 = 除「已取消」外的全部；「已上线【内测版】」已并入「已上线」，不再单独成列。
 */
export const REQ_STATUS = [
  { key: "req_in_progress", label: "需求中", color: "#62626B", stage: "req" },
  { key: "req_done", label: "需求完成", color: "#62626B", stage: "req" },
  { key: "dev_todo", label: "待开发", color: "#005BB5", stage: "dev" },
  { key: "dev_in_progress", label: "开发中", color: "#005BB5", stage: "dev" },
  { key: "dev_done", label: "开发完成", color: "#6941A5", stage: "dev" },
  { key: "test_todo", label: "待测试", color: "#895000", stage: "test" },
  { key: "test_in_progress", label: "测试中", color: "#895000", stage: "test" },
  { key: "test_done", label: "测试完成", color: "#005BB5", stage: "test" },
  { key: "online", label: "已上线", color: "#18703D", stage: "online" },
  { key: "cancelled", label: "已取消", color: "#85858F", stage: "cancelled" },
] as const;

export type ReqStatusKey = (typeof REQ_STATUS)[number]["key"];
export type ReqStageKey = "req" | "dev" | "test" | "online" | "cancelled";

/** 需求池顶部阶段 tab（全部 + 四阶段；已取消仅在「全部」或状态下拉可见） */
export const REQ_STAGE_TABS: { key: "" | ReqStageKey; label: string; statuses: readonly string[] }[] = [
  { key: "", label: "全部", statuses: [] },
  { key: "req", label: "需求阶段", statuses: ["req_in_progress", "req_done"] },
  { key: "dev", label: "开发阶段", statuses: ["dev_todo", "dev_in_progress", "dev_done"] },
  { key: "test", label: "测试阶段", statuses: ["test_todo", "test_in_progress", "test_done"] },
  { key: "online", label: "已上线", statuses: ["online"] },
];

/** 进展总览 / 项目进度：仅「已上线」计为完成 */
export const REQ_DONE_STATUSES = ["online"] as const;

/** 工作台「我的待办」：非终态 */
export const REQ_ACTIVE_STATUSES = [
  "req_in_progress",
  "req_done",
  "dev_todo",
  "dev_in_progress",
  "dev_done",
  "test_todo",
  "test_in_progress",
  "test_done",
] as const;

/** 看板展示列（不含已取消；数据仍保留） */
export const REQ_BOARD_COLUMNS = REQ_STATUS.filter((s) => s.key !== "cancelled");

/**
 * 旧状态 → 新状态 key（数据搬迁、ITR / 飞书同步、旧链接里的 ?status= 归一）。
 * - 11-06 之前存库的中文名（需求中 … 已取消）→ 对应英文 key
 * - 更早的流水线：已完成 → 测试完成（原流水线在开发完与内测之间，最接近测试完成）；未填 → 需求中；已上线【内测版】→ 已上线
 * - 最早的英文 key：todo / in_progress / in_test / ready_for_release / done
 */
export const REQ_STATUS_LEGACY_MAP: Record<string, string> = {
  ...Object.fromEntries(REQ_STATUS.map((s) => [s.label, s.key])),
  未填: "req_in_progress",
  开发完: "dev_done",
  已完成: "test_done",
  "已上线【内测版】": "online",
  todo: "req_in_progress",
  in_progress: "dev_in_progress",
  in_test: "test_in_progress",
  ready_for_release: "online",
  done: "online",
};

export function normalizeReqStatus(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "req_in_progress";
  if (REQ_STATUS.some((x) => x.key === s)) return s;
  if (REQ_STATUS_LEGACY_MAP[s]) return REQ_STATUS_LEGACY_MAP[s];
  return s;
}

export const BUG_STATUS = [
  { key: "open", label: "待处理", color: "#B42318" },
  { key: "in_progress", label: "进行中", color: "#005BB5" },
  { key: "resolved", label: "已解决", color: "#6941A5" },
  { key: "closed", label: "已关闭", color: "#18703D" },
  { key: "reopened", label: "重新打开", color: "#895000" },
  { key: "cancelled", label: "已取消", color: "#85858F" },
] as const;

export const STAGE_GROUP_LABEL: Record<string, string> = {
  req: "需求阶段",
  dev: "开发阶段",
  test: "测试阶段",
  online: "上线",
  cancelled: "其他",
};

/** 「移动到…」菜单 / 状态抽屉使用的选项（按阶段分组） */
export const REQ_STATUS_OPTIONS = REQ_STATUS.map((s) => ({
  key: s.key as string,
  label: s.label as string,
  color: s.color as string,
  group: STAGE_GROUP_LABEL[s.stage],
}));

export const BUG_STATUS_OPTIONS = BUG_STATUS.map((s) => ({
  key: s.key as string,
  label: s.label as string,
  color: s.color as string,
}));

/**
 * Bug 看板列：6 个状态全部显示，顺序和列表的阶段标签一致
 * （待处理 = 待处理 + 重新打开，进行中，已解决，已关闭 = 已关闭 + 已取消）
 */
export const BUG_BOARD_ORDER = ["open", "reopened", "in_progress", "resolved", "closed", "cancelled"] as const;
export const BUG_BOARD_COLUMNS = BUG_BOARD_ORDER.map((k) => BUG_STATUS.find((s) => s.key === k)!);

export const PRIORITY_OPTIONS = ["p0", "p1", "p2", "p3"] as const;

/** 历史数据里既有 p1 也有 P1：统一成小写 key */
export function normalizePriority(raw: string | null | undefined): string {
  const s = String(raw || "").trim().toLowerCase();
  return (PRIORITY_OPTIONS as readonly string[]).includes(s) ? s : "p2";
}

export const PRIORITY_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  p0: { label: "紧急", color: "#DC2626", bg: "#FEF2F2" },
  p1: { label: "高", color: "#EA580C", bg: "#FFF7ED" },
  p2: { label: "中", color: "#CA8A04", bg: "#FEFCE8" },
  p3: { label: "低", color: "#6B6B80", bg: "#F5F5F7" },
};

export const SEVERITY_OPTIONS = ["blocker", "critical", "major", "minor", "trivial"] as const;

export const SEVERITY_LABELS: Record<string, string> = {
  blocker: "阻塞",
  critical: "严重",
  major: "主要",
  minor: "次要",
  trivial: "轻微",
};

export const RELEASE_STATUS: Record<string, { label: string; color: string }> = {
  planning: { label: "规划中", color: "#6B6B80" },
  frozen: { label: "已冻结", color: "#F59E0B" },
  releasing: { label: "发布中", color: "#6366F1" },
  released: { label: "已上线", color: "#10B981" },
  cancelled: { label: "已取消", color: "#9B9BAD" },
};

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  completed: "已完成",
  archived: "已归档",
};

export function releaseStatusLabel(key: string) {
  return RELEASE_STATUS[key]?.label ?? key;
}

/** 发版仍未结束（进展总览「待上线发版」口径） */
export const RELEASE_OPEN_STATUSES = ["planning", "frozen", "releasing"] as const;

export const NAV_ITEMS = [
  { href: "/", label: "工作台", icon: "LayoutDashboard" },
  { href: "/requirements", label: "公共需求池", icon: "ListTodo" },
  { href: "/projects", label: "项目", icon: "FolderKanban" },
  { href: "/board", label: "看板", icon: "Columns3" },
  { href: "/releases", label: "发版", icon: "Rocket" },
  { href: "/bugs", label: "Bug", icon: "Bug" },
  { href: "/leadership", label: "进展总览", icon: "BarChart3" },
  { href: "/members", label: "成员管理", icon: "Users" },
  { href: "/permissions", label: "角色权限", icon: "Shield" },
] as const;

/** Fixed feature keys for RolePermission matrix (Chinese labels in UI). */
/** 项目资料专区预设类型（可扩展自定义名称） */
export const PROJECT_RESOURCE_PRESETS = [
  "需求文档",
  "产品原型",
  "UI设计",
] as const;

export const FEATURES = [
  { key: "users.manage", label: "账号管理" },
  { key: "project.edit", label: "编辑项目" },
  { key: "members.manage", label: "项目成员管理" },
  { key: "requirements.create", label: "新建需求" },
  { key: "requirements.edit", label: "编辑需求" },
  { key: "board.move", label: "看板流转" },
  { key: "releases.manage", label: "发版管理" },
  { key: "bugs.edit", label: "处理 Bug" },
  { key: "bugs.delete", label: "删除 Bug" },
  { key: "leadership.view", label: "查看进展总览" },
  { key: "docs.edit", label: "编辑文档" },
  { key: "products.manage", label: "维护产品结构" },
] as const;


export function reqStatusLabel(key: string) {
  return REQ_STATUS.find((s) => s.key === key)?.label ?? key;
}

export function bugStatusLabel(key: string) {
  return BUG_STATUS.find((s) => s.key === key)?.label ?? key;
}

export function isReqDone(status: string) {
  return (REQ_DONE_STATUSES as readonly string[]).includes(normalizeReqStatus(status));
}

export function statusesForStage(stage: string | undefined | null): string[] | null {
  if (!stage) return null;
  const tab = REQ_STAGE_TABS.find((t) => t.key === stage);
  if (!tab || tab.statuses.length === 0) return null;
  return [...tab.statuses];
}
