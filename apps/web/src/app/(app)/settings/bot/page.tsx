import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { BotSettings } from "@/components/feishu/BotSettings";

export const dynamic = "force-dynamic";

/** 设置 · 飞书机器人（Figma 39–40）：发送渠道、消息通知、定时任务 */
export default async function BotSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "飞书机器人", icon: "message" }]} />
      <div className="nv-page-body">
        <BotSettings />
      </div>
    </div>
  );
}
