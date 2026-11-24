/**
 * 工作台角色（11-22 重做）：9 个角色，按流程顺序排。纯函数，客户端和单元测试都能用。
 * 身兼多岗不切换：一个人的角色 = 默认岗位 + 各项目里的岗位 + 角色（管理者 / 系统管理员），合并在一页里。
 */
export const WB_ROLES = ["business", "product", "designer", "tech_lead", "dev", "qa", "pm", "manager", "admin"] as const;
export type WbRole = (typeof WB_ROLES)[number];

export const WB_ROLE_LABEL: Record<WbRole, string> = {
  business: "业务方",
  product: "产品经理",
  designer: "设计师",
  tech_lead: "技术负责人",
  dev: "开发",
  qa: "测试",
  pm: "项目经理",
  manager: "企业管理者",
  admin: "系统管理员",
};

/** 「待我处理」每条前面的角色标签 */
export const WB_ROLE_CHIP: Record<WbRole, string> = {
  business: "业务",
  product: "产品",
  designer: "设计",
  tech_lead: "技术",
  dev: "开发",
  qa: "测试",
  pm: "项目",
  manager: "管理",
  admin: "系统",
};

export const roleIndex = (r: WbRole) => WB_ROLES.indexOf(r);
export const isWbRole = (v: unknown): v is WbRole => typeof v === "string" && (WB_ROLES as readonly string[]).includes(v);

/** 岗位 key → 工作台角色；自定义岗位返回 null */
export function roleOfPosition(position: string | null | undefined): WbRole | null {
  switch (position) {
    case "business":
      return "business";
    case "product":
      return "product";
    case "designer":
      return "designer";
    case "tech_lead":
      return "tech_lead";
    case "frontend":
    case "backend":
      return "dev";
    case "qa":
      return "qa";
    case "pm":
      return "pm";
    default:
      return null;
  }
}

/** 任务类型 → 处理它的角色 */
export function roleOfTaskKind(kind: string): WbRole {
  if (kind === "design") return "designer";
  if (kind === "test") return "qa";
  if (kind === "release") return "pm";
  return "dev";
}

export function sortRoles(roles: Iterable<WbRole>): WbRole[] {
  return Array.from(new Set(roles)).sort((a, b) => roleIndex(a) - roleIndex(b));
}

/** 一个人的全部角色，按流程顺序；什么岗位都没有的人按开发处理（和原工作台一致） */
export function rolesFor(globalRole: string, position: string | null | undefined, memberRoles: (string | null | undefined)[] = []): WbRole[] {
  const out = new Set<WbRole>();
  const p = roleOfPosition(position);
  if (p) out.add(p);
  for (const m of memberRoles) {
    const r = roleOfPosition(m);
    if (r) out.add(r);
  }
  if (globalRole === "admin") out.add("admin");
  if (globalRole === "manager") out.add("manager");
  if (!out.size) out.add("dev");
  return sortRoles(out);
}

/** 紧急程度：0 卡着别人 / 已逾期，1 今天，2 本周，3 其他 */
export type Urgency = 0 | 1 | 2 | 3;
export const URGENCY_LABEL: Record<Urgency, string> = { 0: "卡着别人 / 已逾期", 1: "今天", 2: "本周", 3: "其他" };

export type InboxItem = {
  /** 去重用：同一件事（如同一个评审）只出现一次 */
  key: string;
  role: WbRole;
  /** 类型标签，如「评审等我」「PRD 待确认」 */
  kind: string;
  tone?: "danger" | "warning" | "info" | "neutral";
  title: string;
  meta: string;
  href: string;
  action: string;
  urgency: Urgency;
  /** 同组同角色里的先后，越早越靠前 */
  at?: string | null;
};

/** 合并「待我处理」：同一件事留流程最靠前的角色；先按紧急程度，再按流程顺序，再按时间 */
export function mergeInbox(items: InboxItem[]): InboxItem[] {
  const byKey = new Map<string, InboxItem>();
  for (const it of items) {
    const prev = byKey.get(it.key);
    if (!prev || it.urgency < prev.urgency || (it.urgency === prev.urgency && roleIndex(it.role) < roleIndex(prev.role))) byKey.set(it.key, it);
  }
  return Array.from(byKey.values()).sort((a, b) => a.urgency - b.urgency || roleIndex(a.role) - roleIndex(b.role) || (a.at || "￿").localeCompare(b.at || "￿"));
}

/** 按紧急程度分组（空组不出现） */
export function groupInbox(items: InboxItem[]): { urgency: Urgency; label: string; items: InboxItem[] }[] {
  const groups: { urgency: Urgency; label: string; items: InboxItem[] }[] = [];
  for (const it of items) {
    let g = groups.find((x) => x.urgency === it.urgency);
    if (!g) groups.push((g = { urgency: it.urgency, label: URGENCY_LABEL[it.urgency], items: [] }));
    g.items.push(it);
  }
  return groups.sort((a, b) => a.urgency - b.urgency);
}

export type WbKpi = { role: WbRole; label: string; value: number; note: string; href: string; danger?: boolean };

/**
 * 指标最多 4 个。只有一个角色时用它自己的 4 个；多个角色时每个角色先出 1 个（有红色的优先出红色的），
 * 角色超过 4 个时保留有红色的、再按流程顺序；不满 4 个再按流程顺序补各角色的其他指标。
 */
export function pickKpis(perRole: { role: WbRole; kpis: WbKpi[] }[], max = 4): WbKpi[] {
  const list = perRole.filter((x) => x.kpis.length).sort((a, b) => roleIndex(a.role) - roleIndex(b.role));
  if (list.length === 1) return list[0].kpis.slice(0, max);
  const lead = list.map((x) => x.kpis.find((k) => k.danger) || x.kpis[0]);
  let chosen = lead;
  if (lead.length > max) {
    const red = lead.filter((k) => k.danger);
    const rest = lead.filter((k) => !k.danger);
    const keep = new Set([...red, ...rest].slice(0, max));
    chosen = lead.filter((k) => keep.has(k));
  }
  for (const x of list) {
    for (const k of x.kpis) {
      if (chosen.length >= max) break;
      if (!chosen.includes(k)) chosen.push(k);
    }
  }
  return chosen.sort((a, b) => roleIndex(a.role) - roleIndex(b.role)).slice(0, max);
}

export type WbButton = { label: string; href: string; primary?: boolean };

/** 顶部按钮：取流程最靠前、有按钮的角色，最多 2 个 */
export function pickButtons(perRole: { role: WbRole; buttons: WbButton[] }[]): WbButton[] {
  const first = [...perRole].sort((a, b) => roleIndex(a.role) - roleIndex(b.role)).find((x) => x.buttons.length);
  return first ? first.buttons.slice(0, 2) : [];
}

/** 侧栏卡片按 key 去重，保留第一次出现的位置 */
export function mergeSide<T extends { key: string }>(cards: T[]): T[] {
  const seen = new Set<string>();
  return cards.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
}
