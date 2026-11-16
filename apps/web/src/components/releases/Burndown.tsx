import { format } from "date-fns";

/**
 * 燃尽图（剩余需求数）：虚线为理想线，实线为实际剩余（截至今天）。
 * 纯 SVG，随容器宽度伸缩。
 */
export function Burndown({
  start,
  end,
  total,
  doneAt,
  now = new Date(),
}: {
  start: Date;
  end: Date;
  total: number;
  /** 每条已完成需求的完成时间 */
  doneAt: Date[];
  now?: Date;
}) {
  const W = 780;
  const H = 168;
  const day = 86400000;
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const e = Math.max(new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime(), s + day);
  const span = e - s;
  const max = Math.max(total, 1);
  const x = (t: number) => ((Math.min(Math.max(t, s), e) - s) / span) * W;
  const y = (n: number) => 4 + (1 - n / max) * (H - 8);

  // 实际线：从开始到今天，按天取剩余数
  const last = Math.min(now.getTime(), e);
  const sorted = doneAt.map((d) => d.getTime()).sort((a, b) => a - b);
  const left = (t: number) => total - sorted.filter((d) => d <= t).length;
  const pts: [number, number][] = [[0, y(total)]];
  for (let t = s + day; t < last; t += day) pts.push([x(t), y(left(t))]);
  if (last > s) pts.push([x(last), y(left(last))]);
  const actual = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");

  const ticks = 6;
  const labels = Array.from({ length: ticks }, (_, i) => new Date(s + (span * i) / (ticks - 1)));

  return (
    <div className="nv-burndown">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`燃尽图：共 ${total} 个需求，剩余 ${total - sorted.filter((d) => d <= now.getTime()).length} 个`}>
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1={0} x2={W} y1={4 + (i * (H - 8)) / 4} y2={4 + (i * (H - 8)) / 4} className="nv-burndown-grid" />
        ))}
        <line x1={0} y1={y(total)} x2={W} y2={y(0)} className="nv-burndown-ideal" />
        {now.getTime() >= s ? <path d={actual} className="nv-burndown-actual" /> : null}
      </svg>
      <div className="nv-burndown-axis" aria-hidden="true">
        {labels.map((d, i) => (
          <span key={i}>{format(d, "M/d")}</span>
        ))}
      </div>
    </div>
  );
}
