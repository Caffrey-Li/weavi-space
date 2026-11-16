import { headers } from "next/headers";
import { getSession } from "@/lib/auth";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { GeneralSettingsForm } from "@/components/settings/GeneralSettingsForm";
import { loadGeneralPage } from "@pm-collab/core/system/general-page-query";

/** 设置 · 常规（Figma 19）：系统标志 + 名称 → 系统名称、访问地址（只读）、默认时区、每周起始日 → 更新设置 */
export default async function GeneralSettingsPage() {
  const session = await getSession();
  const { settings, canEdit } = await loadGeneralPage(session);
  // 访问地址：部署时用 APP_URL 配置；没配时取当前访问的地址
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const appUrl = process.env.APP_URL || (host ? `${proto}://${host}` : "");
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "常规", icon: "sliders" }]} />
      <div className="nv-page-body">
        <GeneralSettingsForm initial={settings} appUrl={appUrl} canEdit={canEdit} />
      </div>
    </div>
  );
}
