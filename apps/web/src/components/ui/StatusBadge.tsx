import {
  REQ_STATUS,
  BUG_STATUS,
  PRIORITY_LABELS,
  RELEASE_STATUS,
  ROLE_LABELS,
  ASSIGNEE_ROLE_LABELS,
  PROJECT_STATUS_LABELS,
  SEVERITY_LABELS,
  normalizeReqStatus,
  normalizePriority,
} from "@/lib/constants";
import { ReqStatusText } from "./ReqStatusText";
import { BUG_STATUS_VISUAL, SEVERITY_VISUAL, PRIORITY_VISUAL, RELEASE_STATUS_VISUAL, REQ_STATUS_VISUAL, UNKNOWN_STATUS_VISUAL } from "./statusVisual";

/** RequirementStatus：图形 + 文字；未知 key 原样显示便于追踪 */
export function ReqStatusBadge({ status, size = "default" }: { status: string; size?: "default" | "small" }) {
  const key = normalizeReqStatus(status);
  const s = REQ_STATUS.find((x) => x.key === key);
  const v = REQ_STATUS_VISUAL[key] || UNKNOWN_STATUS_VISUAL;
  return (
    <span className={`status-badge tone-${v.tone}${size === "small" ? " is-small" : ""}`}>
      <v.Icon size={size === "small" ? 12 : 14} aria-hidden="true" />
      <ReqStatusText statusKey={key} fallback={s?.label || status} />
    </span>
  );
}

const BUG_TONE: Record<string, string> = {
  open: "danger",
  in_progress: "info",
  resolved: "info",
  closed: "success",
  reopened: "warning",
  cancelled: "neutral",
};

export function BugStatusBadge({ status, size = "default" }: { status: string; size?: "default" | "small" }) {
  const s = BUG_STATUS.find((x) => x.key === status);
  const v = BUG_STATUS_VISUAL[status] || { tone: BUG_TONE[status] || "neutral", Icon: UNKNOWN_STATUS_VISUAL.Icon };
  return (
    <span className={`status-badge tone-${v.tone}${size === "small" ? " is-small" : ""}`}>
      <v.Icon size={size === "small" ? 12 : 14} aria-hidden="true" />
      {s?.label || status}
    </span>
  );
}

const PRIORITY_TONE: Record<string, string> = {
  p0: "danger",
  p1: "warning",
  p2: "warning",
  p3: "neutral",
};

export function PriorityBadge({ priority, size = "default" }: { priority: string; size?: "default" | "small" }) {
  const key = normalizePriority(priority);
  const p = PRIORITY_LABELS[key];
  const v = PRIORITY_VISUAL[key];
  return (
    <span
      className={`status-badge is-priority tone-${v?.tone || PRIORITY_TONE[key] || "neutral"}${size === "small" ? " is-small" : ""}`}
      title={`优先级 ${key.toUpperCase()}`}
    >
      {v ? <v.Icon size={size === "small" ? 12 : 14} aria-hidden="true" /> : null}
      <span className="sr-only">优先级</span>
      {p.label}
    </span>
  );
}

const RELEASE_TONE: Record<string, string> = {
  planning: "neutral",
  frozen: "warning",
  releasing: "info",
  released: "success",
  cancelled: "neutral",
};

export function ReleaseStatusBadge({ status }: { status: string }) {
  const s = RELEASE_STATUS[status];
  const v = RELEASE_STATUS_VISUAL[status] || { tone: RELEASE_TONE[status] || "neutral", Icon: UNKNOWN_STATUS_VISUAL.Icon };
  return (
    <span className={`status-badge tone-${v.tone}`}>
      <v.Icon size={14} aria-hidden="true" />
      {s?.label || status}
    </span>
  );
}

const PROJECT_TONE: Record<string, string> = { active: "info", completed: "success", archived: "neutral" };

export function ProjectStatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${PROJECT_TONE[status] || "neutral"}`}>{PROJECT_STATUS_LABELS[status] || status}</span>
  );
}

/** 需求上的负责人槽位（产品负责人/前端负责人…），区别于人员岗位 */
export function AssigneeRoleBadge({ role }: { role: string }) {
  return <span className="badge badge-neutral">{ASSIGNEE_ROLE_LABELS[role] || ROLE_LABELS[role] || role}</span>;
}

/** Soft role colors: readable contrast, not neon. Admin intentionally muted. */
const ROLE_BADGE: Record<string, { color: string; bg: string }> = {
  admin: { color: "#5C5670", bg: "#F0EEF4" },
  director: { color: "#6B5B4F", bg: "#F5F1ED" },
  pm: { color: "#3D6B8A", bg: "#EDF3F7" },
  product: { color: "#5A6B3D", bg: "#F2F5ED" },
  tech_lead: { color: "#55557A", bg: "#EEEEF6" },
  backend: { color: "#4A6670", bg: "#EEF3F5" },
  frontend: { color: "#4A6B8A", bg: "#EEF3F8" },
  qa: { color: "#7A5A2E", bg: "#F7F1E8" },
  member: { color: "#6A6A7A", bg: "#F4F4F6" },
};

export function RoleBadge({ role }: { role: string }) {
  const c = ROLE_BADGE[role] || ROLE_BADGE.member;
  return (
    <span className="badge" style={{ background: c.bg, color: c.color }}>
      {ROLE_LABELS[role] || role}
    </span>
  );
}

/** Bug 严重级别：图形 + 文字 */
export function SeverityBadge({ severity }: { severity: string }) {
  const v = SEVERITY_VISUAL[severity] || { tone: "neutral", Icon: UNKNOWN_STATUS_VISUAL.Icon };
  return (
    <span className={`status-badge is-priority tone-${v.tone}`}>
      <v.Icon size={14} aria-hidden="true" />
      <span className="sr-only">严重级别</span>
      {SEVERITY_LABELS[severity] || severity}
    </span>
  );
}

/** Bug 的展示编号（库里没有独立编号字段，取 id 末 4 位） */
export function bugCode(id: string) {
  return `BUG-${id.slice(-4).toUpperCase()}`;
}
