import { NotificationsList } from "@/components/settings/NotificationsList";
import { WorkHeader } from "@/components/layout/WorkHeader";

export const dynamic = "force-dynamic";

/** 消息通知：全部通知，分页；推送到飞书机器人在「设置 · 飞书机器人」里按事件订阅 */
export default function NotificationsPage() {
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "消息通知", icon: "message" }]} />
      <div className="nv-page-body">
        <NotificationsList />
      </div>
    </div>
  );
}
