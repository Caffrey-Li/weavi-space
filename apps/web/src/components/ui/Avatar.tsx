"use client";

import { useEffect, useState } from "react";
import { initials } from "@/lib/utils";

/** 首字头像：Nova 角色色实底 + 白字（DESIGN-SPEC §5.3 Avatar），按姓名稳定取色 */
const TONES = [
  { bg: "var(--nv-role-pm)", fg: "#fff" },
  { bg: "var(--nv-role-product)", fg: "#fff" },
  { bg: "var(--nv-role-frontend)", fg: "#fff" },
  { bg: "var(--nv-role-backend)", fg: "#fff" },
  { bg: "var(--nv-role-qa)", fg: "#fff" },
  { bg: "var(--nv-role-tech-lead)", fg: "#fff" },
  { bg: "var(--nv-role-director)", fg: "#fff" },
];

export function Avatar({
  name,
  src,
  size = 24,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [src]);
  const tone = TONES[(name?.charCodeAt(0) || 0) % TONES.length];
  const showImg = Boolean(src) && !imgFailed;

  if (showImg) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src!}
        alt={name}
        title={name}
        width={size}
        height={size}
        className="inline-block shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <span
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium"
      style={{ width: size, height: size, fontSize: size * 0.42, background: tone.bg, color: tone.fg }}
    >
      {initials(name || "?")}
    </span>
  );
}

export function AvatarGroup({ names, size = 22 }: { names: string[]; size?: number }) {
  return (
    <div className="flex -space-x-1.5">
      {names.slice(0, 4).map((n) => (
        <span key={n} className="ring-2 ring-white rounded-full">
          <Avatar name={n} size={size} />
        </span>
      ))}
    </div>
  );
}
