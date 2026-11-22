import { BUG_GLYPH, PriorityGlyph, RELEASE_GLYPH, REQ_GLYPH, SeverityDot, UNKNOWN_GLYPH, type GlyphProps } from "./Glyphs";

const pri = (k: string) => {
  const G = (p: GlyphProps) => <PriorityGlyph priority={k} size={p.size} className={p.className} />;
  return G;
};
const sev = (k: string) => {
  const G = () => <SeverityDot severity={k} />;
  return G;
};

export type VisualIcon = React.ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "purple";

/**
 * 需求 10 态的视觉字典（COMPONENTS.md · 业务枚举映射）：
 * 文字 + 图形共同表达，颜色只做辅助；同阶段允许共用色族。
 */
export const REQ_STATUS_VISUAL: Record<string, { tone: Tone; Icon: VisualIcon }> = {
  req_in_progress: { tone: "neutral", Icon: REQ_GLYPH["req_in_progress"] },
  req_done: { tone: "neutral", Icon: REQ_GLYPH["req_done"] },
  req_design: { tone: "purple", Icon: REQ_GLYPH["req_design"] },
  dev_todo: { tone: "info", Icon: REQ_GLYPH["dev_todo"] },
  dev_in_progress: { tone: "info", Icon: REQ_GLYPH["dev_in_progress"] },
  dev_done: { tone: "purple", Icon: REQ_GLYPH["dev_done"] },
  test_todo: { tone: "warning", Icon: REQ_GLYPH["test_todo"] },
  test_in_progress: { tone: "warning", Icon: REQ_GLYPH["test_in_progress"] },
  test_done: { tone: "info", Icon: REQ_GLYPH["test_done"] },
  online: { tone: "success", Icon: REQ_GLYPH["online"] },
  cancelled: { tone: "neutral", Icon: REQ_GLYPH["cancelled"] },
};

export const UNKNOWN_STATUS_VISUAL: { tone: Tone; Icon: VisualIcon } = { tone: "neutral", Icon: UNKNOWN_GLYPH };

export const PRIORITY_VISUAL: Record<string, { tone: Tone; Icon: VisualIcon }> = {
  p0: { tone: "danger", Icon: pri("p0") },
  p1: { tone: "warning", Icon: pri("p1") },
  p2: { tone: "info", Icon: pri("p2") },
  p3: { tone: "neutral", Icon: pri("p3") },
};

export const RELEASE_STATUS_VISUAL: Record<string, { tone: Tone; Icon: VisualIcon }> = {
  planning: { tone: "neutral", Icon: RELEASE_GLYPH["planning"] },
  frozen: { tone: "warning", Icon: RELEASE_GLYPH["frozen"] },
  releasing: { tone: "info", Icon: RELEASE_GLYPH["releasing"] },
  released: { tone: "success", Icon: RELEASE_GLYPH["released"] },
  cancelled: { tone: "neutral", Icon: RELEASE_GLYPH["cancelled"] },
};

export const BUG_STATUS_VISUAL: Record<string, { tone: Tone; Icon: VisualIcon }> = {
  open: { tone: "danger", Icon: BUG_GLYPH["open"] },
  in_progress: { tone: "info", Icon: BUG_GLYPH["in_progress"] },
  resolved: { tone: "purple", Icon: BUG_GLYPH["resolved"] },
  closed: { tone: "success", Icon: BUG_GLYPH["closed"] },
  reopened: { tone: "warning", Icon: BUG_GLYPH["reopened"] },
  cancelled: { tone: "neutral", Icon: BUG_GLYPH["cancelled"] },
};

export const SEVERITY_VISUAL: Record<string, { tone: Tone; Icon: VisualIcon }> = {
  blocker: { tone: "danger", Icon: sev("blocker") },
  critical: { tone: "danger", Icon: sev("critical") },
  major: { tone: "warning", Icon: sev("major") },
  minor: { tone: "info", Icon: sev("minor") },
  trivial: { tone: "neutral", Icon: sev("trivial") },
};
