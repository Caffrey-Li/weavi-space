import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { RouteTabs } from "@/components/ui/RouteTabs";
import { FeishuTablesPanel } from "@/components/feishu/FeishuTablesPanel";
import { CloudDocsPanel } from "@/components/feishu/CloudDocsPanel";

export const dynamic = "force-dynamic";

const PROVIDERS = [
  { key: "feishu", label: "飞书", ready: true },
  { key: "wecom", label: "企业微信", ready: false },
  { key: "dingtalk", label: "钉钉", ready: false },
];

/**
 * 设置 · 云表格（原「飞书表格同步」，Figma 36–38）：标签「云表格 / 云文档」；
 * 平台先做飞书，企业微信、钉钉预留板块（置灰，待开发）。
 */
export default async function CloudTablesPage(props: { searchParams: Promise<{ tab?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  const { tab } = await props.searchParams;
  const docs = tab === "docs";
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: docs ? "云文档" : "云表格", icon: "refresh" }]} />
      <div className="nv-page-body">
        <div className="nv-set nv-ftab">
          <RouteTabs
            label="云表格与云文档"
            current={docs ? "docs" : ""}
            tabs={[
              { key: "", label: "云表格", href: "/system/feishu-tables" },
              { key: "docs", label: "云文档", href: "/system/feishu-tables?tab=docs" },
            ]}
          />
          <div className="nv-cloud-providers" role="list" aria-label="平台">
            {PROVIDERS.map((p) => (
              <span key={p.key} role="listitem" className={`nv-cloud-provider${p.ready ? " is-active" : " is-disabled"}`} aria-disabled={!p.ready || undefined} title={p.ready ? undefined : "待开发"}>
                {p.label}
                {p.ready ? null : <span className="nv-tag is-neutral">待开发</span>}
              </span>
            ))}
          </div>
          {docs ? <CloudDocsPanel /> : <FeishuTablesPanel />}
        </div>
      </div>
    </div>
  );
}
