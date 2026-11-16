import Link from "next/link";
import { ProjectIcon } from "./ProjectIcon";
import { projectTone } from "@/lib/project-tone";
import { Avatar } from "@/components/ui/Avatar";

export type ProjectCardData = {
  id: string;
  name: string;
  key: string;
  iconUrl?: string | null;
  coverUrl?: string | null;
  status: string;
  done: number;
  all: number;
  owner?: { name: string; avatarUrl?: string | null } | null;
  joined: boolean;
  members: { id: string; name: string; avatarUrl?: string | null }[];
};

/** 项目卡（Figma 03）：封面（背景图或色带）+ 项目图标 → 名称、Key、负责人、进度 → 成员头像组 + 已加入 */
export function ProjectCard({ p }: { p: ProjectCardData }) {
  const pct = p.all ? Math.round((p.done / p.all) * 100) : 0;
  const tone = projectTone(p.name);
  return (
    <Link href={`/projects/${p.id}`} className={`nv-pcard${p.status === "archived" ? " is-archived" : ""}`}>
      <span
        className={`nv-pcard-cover${p.coverUrl ? " has-image" : ""}`}
        style={
          p.coverUrl
            ? { backgroundImage: `url("${p.coverUrl}")` }
            : { background: `color-mix(in srgb, ${tone} 10%, var(--nv-bg-surface))` }
        }
      >
        <ProjectIcon name={p.name} src={p.iconUrl} size={32} />
      </span>
      <span className="nv-pcard-body">
        <span className="nv-pcard-name">{p.name}</span>
        <span className="nv-pcard-key">{p.key}</span>
        <span className="nv-pcard-owner">
          {p.owner ? (
            <>
              <Avatar name={p.owner.name} src={p.owner.avatarUrl} size={16} />
              负责人 {p.owner.name}
            </>
          ) : (
            "未设负责人"
          )}
        </span>
        <span className="nv-pcard-progress">
          <span
            className="nv-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={`${p.name} 上线进度 ${p.done}/${p.all}`}
          >
            <span style={{ width: `${pct}%`, background: tone }} />
          </span>
          <span className="nv-pcard-pct">{pct}%</span>
        </span>
      </span>
      <span className="nv-pcard-foot">
        <span className="nv-avatar-group" aria-label={`${p.members.length} 名成员`}>
          {p.members.slice(0, 3).map((m) => (
            <Avatar key={m.id} name={m.name} src={m.avatarUrl} size={20} />
          ))}
          {p.members.length > 3 ? <span className="nv-avatar-more">+{p.members.length - 3}</span> : null}
        </span>
        {p.status === "archived" ? (
          <span className="nv-tag">已归档</span>
        ) : p.status === "completed" ? (
          <span className="nv-tag is-info">已完成</span>
        ) : p.joined ? (
          <span className="nv-tag is-success">已加入</span>
        ) : null}
      </span>
    </Link>
  );
}
