import type React from "react";
/**
 * Nova 状态语言图形（DESIGN-SPEC §4）：颜色表示阶段，图形表示进度。
 * 与 lucide 图标同样的调用方式（size / className / aria-hidden），可直接放进 visualOf。
 */
import type { CSSProperties } from "react";

export type GlyphProps = { size?: number; className?: string; style?: CSSProperties; "aria-hidden"?: boolean | "true" | "false" };
export type GlyphIcon = (props: GlyphProps) => React.JSX.Element;

type Kind = "dashed" | "ring" | "pie" | "done" | "cancel" | "square";

function StatusGlyph({ kind, color, frac = 0, size = 14, className, style }: GlyphProps & { kind: Kind; color: string; frac?: number }) {
  const c = `var(--nv-${color})`;
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    className: `nv-glyph${className ? ` ${className}` : ""}`,
    style,
    "aria-hidden": true as const,
    focusable: "false" as const,
  };
  if (kind === "done")
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="7" fill={c} />
        <path d="M4.8 8.3 7 10.4l4.2-4.5" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (kind === "cancel")
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="7" fill={c} />
        <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  if (kind === "square")
    return (
      <svg {...common}>
        <rect x="3" y="3" width="10" height="10" rx="2" fill={c} />
      </svg>
    );
  let inner: React.JSX.Element | null = null;
  if (kind === "pie") {
    if (frac >= 1) inner = <circle cx="8" cy="8" r="3.5" fill={c} />;
    else {
      const a = -Math.PI / 2 + 2 * Math.PI * frac;
      inner = (
        <path
          d={`M8 8V4.5A3.5 3.5 0 ${frac > 0.5 ? 1 : 0} 1 ${(8 + 3.5 * Math.cos(a)).toFixed(2)} ${(8 + 3.5 * Math.sin(a)).toFixed(2)}Z`}
          fill={c}
        />
      );
    }
  }
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="6" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray={kind === "dashed" ? "2.2 2" : undefined} />
      {inner}
    </svg>
  );
}

function make(kind: Kind, color: string, frac?: number): GlyphIcon {
  const G = (p: GlyphProps) => <StatusGlyph {...p} kind={kind} color={color} frac={frac} />;
  return G;
}

export const REQ_GLYPH: Record<string, GlyphIcon> = {
  req_in_progress: make("dashed", "state-req"),
  req_done: make("pie", "state-req", 1),
  dev_todo: make("ring", "state-dev"),
  dev_in_progress: make("pie", "state-dev", 0.5),
  dev_done: make("pie", "state-dev", 1),
  test_todo: make("ring", "state-test"),
  test_in_progress: make("pie", "state-test", 0.5),
  test_done: make("pie", "state-test", 1),
  online: make("done", "state-done"),
  cancelled: make("cancel", "state-cancelled"),
};

export const BUG_GLYPH: Record<string, GlyphIcon> = {
  open: make("ring", "danger-solid"),
  in_progress: make("pie", "state-dev", 0.5),
  resolved: make("pie", "state-review", 1),
  closed: make("done", "state-done"),
  reopened: make("dashed", "warning-solid"),
  cancelled: make("cancel", "state-cancelled"),
};

export const RELEASE_GLYPH: Record<string, GlyphIcon> = {
  planning: make("dashed", "state-req"),
  frozen: make("pie", "state-review", 1),
  releasing: make("pie", "state-dev", 0.5),
  released: make("done", "state-done"),
  cancelled: make("cancel", "state-cancelled"),
};

export const UNKNOWN_GLYPH = make("ring", "state-req");

/** 严重程度：阻塞为实心方块，其余为圆点 */
export function SeverityDot({ severity, size = 8 }: { severity: string; size?: number }) {
  const color: Record<string, string> = {
    blocker: "danger-solid",
    critical: "danger-solid",
    major: "warning-solid",
    minor: "state-dev",
    trivial: "state-cancelled",
  };
  const c = `var(--nv-${color[severity] || "state-cancelled"})`;
  return (
    <span
      aria-hidden="true"
      className="nv-sev-dot"
      style={{ width: size, height: size, background: c, borderRadius: severity === "blocker" ? 2 : 999 }}
    />
  );
}

/** 优先级：P0 紧急为红底「!」方块，其余为 3 格信号（P1 3 格、P2 2 格、P3 1 格） */
export function PriorityGlyph({ priority, size = 14, className }: { priority: string; size?: number; className?: string }) {
  const key = (priority || "").toLowerCase();
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    className: `nv-glyph${className ? ` ${className}` : ""}`,
    "aria-hidden": true as const,
    focusable: "false" as const,
  };
  if (key === "p0")
    return (
      <svg {...common}>
        <rect x="1" y="1" width="14" height="14" rx="4" fill="var(--nv-priority-urgent)" />
        <rect x="7" y="3.5" width="2" height="5.5" rx="1" fill="#fff" />
        <circle cx="8" cy="11.5" r="1" fill="#fff" />
      </svg>
    );
  const level = key === "p1" ? 3 : key === "p2" ? 2 : key === "p3" ? 1 : 0;
  const col = { 3: "priority-high", 2: "priority-medium", 1: "priority-low", 0: "priority-none" }[level];
  const bars: [number, number, number][] = [
    [2, 9, 5],
    [6.5, 6, 8],
    [11, 3, 11],
  ];
  return (
    <svg {...common}>
      {bars.map(([x, y, h], i) => (
        <rect key={i} x={x} y={y} width="3" height={h} rx="1" fill={`var(--nv-${i < level ? col : "border-strong"})`} />
      ))}
    </svg>
  );
}
