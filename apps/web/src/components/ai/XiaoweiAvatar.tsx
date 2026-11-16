/* eslint-disable @next/next/no-img-element */

/**
 * 会动的小围头像（Figma「82」）：按状态换姿势，进行中轻微浮动，回答完成时挥手一次。
 * 姿势图在 public/brand；系统开了「减少动态效果」时只换姿势不做动画（CSS 里处理）。
 */
export type XiaoweiState = "idle" | "thinking" | "searching" | "working" | "waiting" | "done" | "error";

const POSE: Record<XiaoweiState, { src: string; label: string }> = {
  idle: { src: "/brand/wave.jpg", label: "小围" },
  thinking: { src: "/brand/think.jpg", label: "小围正在思考" },
  searching: { src: "/brand/search.jpg", label: "小围正在查资料" },
  working: { src: "/brand/working.jpg", label: "小围正在动手" },
  waiting: { src: "/brand/think.jpg", label: "小围在等你确认" },
  done: { src: "/brand/done.jpg", label: "小围完成了" },
  error: { src: "/brand/sleep.jpg", label: "小围没做成" },
};

export function XiaoweiAvatar({ state = "idle", size = 32, decorative = false }: { state?: XiaoweiState; size?: number; decorative?: boolean }) {
  const p = POSE[state];
  return (
    <span className={`nv-xw is-${state}`} style={{ width: size, height: size }} role={decorative ? undefined : "img"} aria-label={decorative ? undefined : p.label} aria-hidden={decorative || undefined}>
      {/* key：换姿势时重新挂载，播放一次切换动画 */}
      <img key={p.src} src={p.src} alt="" draggable={false} />
    </span>
  );
}
