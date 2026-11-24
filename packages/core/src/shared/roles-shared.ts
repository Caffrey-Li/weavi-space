/**
 * 角色与岗位（前后端共用，不依赖数据库）
 * - 角色（Role）：决定「能做什么」（功能权限）和「能看到哪些数据」（数据范围）。存 User.globalRole。
 * - 岗位（Position）：人在项目 / 产品里的职责（产品经理、前端…），只用于选人和展示，不决定权限。
 *   存 User.position（默认岗位）和 ProjectMember.role（项目内岗位）。
 */

export type DataScope = "all" | "enterprise" | "dept" | "involved" | "self";

export const DATA_SCOPES: { key: DataScope; label: string; hint: string }[] = [
  { key: "all", label: "全部数据", hint: "所有企业的数据，只有系统管理员是这一档" },
  { key: "enterprise", label: "本企业", hint: "所属企业（二级组织）的全部项目、产品、需求和 Bug" },
  { key: "dept", label: "本部门及下级", hint: "本企业内，本部门及下级部门成员参与的项目，以及自己参与的项目" },
  { key: "involved", label: "参与的项目和产品", hint: "本企业内，自己是成员的项目，及自己负责的产品和项目所属产品" },
  { key: "self", label: "仅本人", hint: "本企业内，只看自己创建或负责的需求和 Bug" },
];

export function dataScopeLabel(k: string | null | undefined) {
  return DATA_SCOPES.find((s) => s.key === k)?.label || "参与的项目和产品";
}

export type RoleRow = { id: string; key: string; name: string; description: string | null; dataScope: string; isSystem: boolean; sortOrder: number; enterpriseId?: string };
export type PositionRow = { id: string; key: string; name: string; description: string | null; isSystem: boolean; sortOrder: number };

export const ADMIN_ROLE = "admin";

export const DEFAULT_ROLES: Omit<RoleRow, "id">[] = [
  { key: "admin", name: "系统管理员", description: "拥有全部功能与数据，不可修改", dataScope: "all", isSystem: true, sortOrder: 0 },
  { key: "manager", name: "管理者", description: "企业（二级组织）负责人：管理本企业的账号、项目与发版", dataScope: "enterprise", isSystem: true, sortOrder: 1 },
  { key: "member", name: "成员", description: "日常协作：处理需求、Bug 与文档", dataScope: "involved", isSystem: true, sortOrder: 2 },
  { key: "guest", name: "访客", description: "只读查看参与的项目", dataScope: "involved", isSystem: true, sortOrder: 3 },
];

export const DEFAULT_POSITIONS: Omit<PositionRow, "id">[] = [
  { key: "pm", name: "项目经理", description: "负责项目计划、进度与发版", isSystem: true, sortOrder: 0 },
  { key: "product", name: "产品经理", description: "负责需求与产品结构", isSystem: true, sortOrder: 1 },
  { key: "tech_lead", name: "技术负责人", description: "负责技术方案与研发质量", isSystem: true, sortOrder: 2 },
  { key: "frontend", name: "前端开发", description: "", isSystem: true, sortOrder: 3 },
  { key: "backend", name: "后端开发", description: "", isSystem: true, sortOrder: 4 },
  { key: "qa", name: "测试", description: "负责测试与验收", isSystem: true, sortOrder: 5 },
  { key: "business", name: "业务", description: "提出业务需求、跟进上线和验收", isSystem: true, sortOrder: 6 },
  { key: "designer", name: "设计师", description: "把 PRD 做成原型和 UI 设计稿", isSystem: true, sortOrder: 7 },
];

/**
 * 角色层级（数字越小级别越高），顺序同 constants.ts 的 ROLE_LABELS：系统管理员 > 管理者 > 成员和自定义角色 > 访客。
 * 系统管理员是唯一的超管：只有它能改角色权限矩阵、授予或撤销管理员。
 */
export function roleRank(role: string): number {
  if (role === ADMIN_ROLE) return 0;
  if (role === "manager") return 1;
  if (role === "guest") return 3;
  return 2;
}

/** 操作者能否管理某个角色的人、或把别人设为这个角色：系统管理员都可以，其余只能管级别比自己低的（所以不能改自己和同级） */
export function outranks(actorRole: string, targetRole: string) {
  return actorRole === ADMIN_ROLE || roleRank(targetRole) > roleRank(actorRole);
}

/** ProjectMember.role 的「未设置岗位」 */
export const NO_POSITION = "member";

const MEMBER_FEATURES = new Set(["requirements.create", "requirements.edit", "board.move", "bugs.edit", "leadership.view", "docs.edit", "products.manage"]);

/** 角色未显式配置某功能时的默认值（新建自定义角色也按「成员」起步） */
export function defaultRoleAllow(role: string, feature: string): boolean {
  if (role === "admin" || role === "manager") return true;
  if (role === "guest") return feature === "leadership.view";
  // 删除 Bug 默认只给项目管理员（管理员、管理者已在上面放行），其他角色在权限矩阵里单独开
  if (feature === "bugs.delete") return role === "project_manager";
  return MEMBER_FEATURES.has(feature);
}

/** 角色 key：小写字母开头，字母数字下划线，2–30 位 */
export const ROLE_KEY_RE = /^[a-z][a-z0-9_]{1,29}$/;
