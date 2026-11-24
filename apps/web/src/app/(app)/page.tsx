import Link from "next/link";
import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";
import { zhCN } from "date-fns/locale";
import { getSession } from "@/lib/auth";
import { loadWorkbenchData } from "@pm-collab/core/workbench/home-query";
import { loadRoleWorkbench } from "@pm-collab/core/workbench/role-workbench";
import { Avatar } from "@/components/ui/Avatar";
import { RoleChip, RoleWorkbenchBody, summaryLine } from "@/components/workbench/RoleWorkbench";

function greeting(d: Date) {
  const h = d.getHours();
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** 文案规范 §10：1 小时内「N 分钟前」，今天「今天 14:20」，昨天「昨天 14:20」，其余「10 月 28 日」 */
function relTime(d: Date, now: Date) {
  const diff = now.getTime() - d.getTime();
  if (diff < 60 * 60 * 1000) return diff < 60 * 1000 ? "刚刚" : `${formatDistanceToNowStrict(d, { locale: zhCN, unit: "minute" })}前`;
  if (isToday(d)) return `今天 ${format(d, "HH:mm")}`;
  if (isYesterday(d)) return `昨天 ${format(d, "HH:mm")}`;
  return d.getFullYear() === now.getFullYear() ? format(d, "M 月 d 日") : format(d, "yyyy 年 M 月 d 日");
}

/**
 * 工作台（11-22 按角色重做，Figma 95）：9 个角色共用一个骨架；身兼多岗不切换，几个角色的内容合在一页，
 * 「待我处理」按紧急程度、同级按流程顺序排，主区块按流程顺序排。查询在 packages/core/src/workbench/role-workbench.ts。
 */
export default async function WorkbenchPage() {
  const user = await getSession();
  if (!user) return null;

  const now = new Date();
  const [data, { entityOf, recent }] = await Promise.all([loadRoleWorkbench(user, now), loadWorkbenchData(user, now)]);
  const multi = data.roles.length > 1;

  const activity = recent.length ? (
    <section className="nv-wb-card is-side" aria-labelledby="wb-recent">
      <div className="nv-wb-card-head">
        <h2 id="wb-recent">最近动态</h2>
      </div>
      <ul className="nv-activity nv-wb-activity">
        {recent.slice(0, 5).map((l) => {
          const e = entityOf.get(l.entityId)!;
          return (
            <li key={l.id}>
              <Avatar name={l.actor?.name || "系统"} src={l.actor?.avatarUrl} size={20} />
              <span className="nv-activity-actor">{l.actor?.name || "系统"}</span>
              <span className="nv-activity-action">{l.message || l.action}</span>
              <Link href={e.href} className="nv-activity-target" title={e.label}>
                {e.label}
              </Link>
              <time dateTime={l.createdAt.toISOString()}>{relTime(l.createdAt, now)}</time>
            </li>
          );
        })}
      </ul>
    </section>
  ) : null;

  return (
    <div className="page-overview is-workbench">
      <header className="page-hero nv-wb-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/wave.jpg" alt="" aria-hidden="true" className="wv-only wv-hero-mascot" />
        <div className="nv-wb-hero-text">
          <h1 className="page-title">
            {greeting(now)}，{user.name}
          </h1>
          <p className="page-summary">{summaryLine(data)}</p>
          {multi ? (
            <p className="nv-wb-roles" aria-label="我的角色">
              {data.roles.map((r) => (
                <RoleChip key={r} role={r} />
              ))}
            </p>
          ) : null}
        </div>
        {data.buttons.length ? (
          <div className="nv-wb-actions">
            {data.buttons.map((b) => (
              <Link key={b.href} href={b.href} className={b.primary ? "btn-primary nv-head-btn" : "btn-secondary nv-head-btn"}>
                {b.label}
              </Link>
            ))}
          </div>
        ) : null}
      </header>
      <RoleWorkbenchBody data={data} extraSide={activity} />
    </div>
  );
}
