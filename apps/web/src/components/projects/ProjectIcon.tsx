"use client";

import { useEffect, useState } from "react";
import { projectTone } from "@/lib/project-tone";

export { projectTone };

/** 项目图标：首字母方块，Nova 色板实底 + 白字 */

export function ProjectIcon({
  name,
  src,
  size = 36,
  className = "",
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const letter = (name || "?").slice(0, 1).toUpperCase();
  const show = Boolean(src) && !failed;

  if (show) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src!}
        alt={name}
        title={name}
        width={size}
        height={size}
        className={`inline-block shrink-0 rounded-lg object-cover ${className}`}
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      title={name}
      className={`inline-flex shrink-0 items-center justify-center font-semibold text-white ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.5)),
        borderRadius: size <= 24 ? "var(--nv-radius-xs)" : "var(--nv-radius-md)",
        background: projectTone(name),
      }}
    >
      {letter}
    </span>
  );
}
