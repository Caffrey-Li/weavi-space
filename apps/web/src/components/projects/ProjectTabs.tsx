import Link from "next/link";

export type ProjectTabKey = "overview" | "requirements" | "board" | "bugs" | "releases" | "members";

/** 项目上下文的统一子导航：同一个项目的需求池、看板、Bug、发版、成员互相一跳可达。 */
export function ProjectTabs({ projectId, active }: { projectId: string; active: ProjectTabKey }) {
  const tabs: { key: ProjectTabKey; label: string; href: string }[] = [
    { key: "overview", label: "概览", href: `/projects/${projectId}` },
    { key: "requirements", label: "需求池", href: `/projects/${projectId}/requirements` },
    { key: "board", label: "项目看板", href: `/board?project=${projectId}` },
    { key: "bugs", label: "Bug", href: `/bugs?project=${projectId}` },
    { key: "releases", label: "发版", href: `/releases?project=${projectId}` },
    { key: "members", label: "成员", href: `/projects/${projectId}/members` },
  ];
  return (
    <nav className="project-tabs" aria-label="项目内导航">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`project-tab${t.key === active ? " is-active" : ""}`}
          aria-current={t.key === active ? "page" : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
