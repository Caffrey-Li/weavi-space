import Link from "next/link";

export type RouteTab = { key: string; label: string; href: string; count?: number; title?: string };

/**
 * Tabs（路由型）：每个 Tab 是真实链接，用 aria-current 标记当前项；
 * 不是 tablist/tabpanel。窄屏可横向滚动。
 */
export function RouteTabs({ tabs, current, label }: { tabs: RouteTab[]; current: string; label: string }) {
  return (
    <nav className="route-tabs" aria-label={label}>
      {tabs.map((t) => {
        const active = t.key === current;
        return (
          <Link
            key={t.key || "all"}
            href={t.href}
            className={`route-tab${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
            title={t.title}
          >
            {t.label}
            {t.count != null ? <span className="route-tab-count">{t.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
