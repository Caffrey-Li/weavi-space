/** 进度环（发版行 32、发版详情 48）：颜色跟随状态，100% 用 success */
export function ProgressRing({ pct, size = 32, color }: { pct: number; size?: number; color?: string }) {
  const stroke = size >= 48 ? 4 : 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  const col = color || (v >= 100 ? "var(--nv-state-done)" : "var(--nv-accent-default)");
  return (
    <span className="nv-ring" style={{ width: size, height: size }} role="img" aria-label={`完成 ${v}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--nv-bg-sunken)" strokeWidth={stroke} />
        {v > 0 ? (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={col}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(c * v) / 100} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        ) : null}
      </svg>
      <span className="nv-ring-text" style={{ fontSize: size >= 48 ? 12 : 10 }}>
        {v}%
      </span>
    </span>
  );
}
