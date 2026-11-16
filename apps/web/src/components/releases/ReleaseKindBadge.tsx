import { CalendarClock, Siren } from "lucide-react";
import { RELEASE_KINDS, releaseKind } from "@/lib/release-schedule-shared";

/** 发版类型标签：固定发版 / 紧急发版（普通发版不显示） */
export function ReleaseKindBadge({ kind }: { kind?: string | null }) {
  const k = releaseKind(kind);
  if (k === "normal") return null;
  const Icon = k === "hotfix" ? Siren : CalendarClock;
  return (
    <span className={`badge badge-${RELEASE_KINDS[k].tone} ml-2 inline-flex items-center gap-1 align-middle`}>
      <Icon size={12} aria-hidden="true" />
      {RELEASE_KINDS[k].label}
    </span>
  );
}
