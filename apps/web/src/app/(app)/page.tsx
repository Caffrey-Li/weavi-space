import Link from "next/link";
import { format, formatDistanceToNowStrict, isToday, isYesterday, startOfDay } from "date-fns";
import { zhCN } from "date-fns/locale";
import { getSession } from "@/lib/auth";
import { loadWorkbenchData } from "@pm-collab/core/workbench/home-query";
import { LAYOUT_LABEL, loadRoleExtras, loadWorkbenchLayout } from "@pm-collab/core/workbench/role-query";
import { RequirementPoolTable } from "@/components/requirements/RequirementPoolTable";
import { toPoolRows } from "@/lib/requirements-pool";
import { Avatar } from "@/components/ui/Avatar";
import { proposedByMe } from "@pm-collab/core/requirements/flow";
import { myTasks } from "@pm-collab/core/requirements/tasks";
import { TASK_KIND_LABEL, TASK_STATUS_LABEL, isTaskKind, isTaskStatus } from "@pm-collab/core/shared/tasks-shared";

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

export default async function WorkbenchPage() {
  const user = await getSession();
  if (!user) return null;

  const now = new Date();
  const { myReqs, myBugs, perms, entityOf, recent, weekStart, weekEnd } = await loadWorkbenchData(user, now);
  // 按角色 / 岗位选版式：管理者、产品、项目、开发、业务
  const layout = await loadWorkbenchLayout(user);
  const extras = await loadRoleExtras(user, layout, now);
  const proposed = await proposedByMe(user);
  // T45 我的任务：指派给我、没完成的任务，按截止日排
  const tasks = await myTasks(user, { take: 8 });

  const todoRows = toPoolRows(myReqs.slice(0, 6));

  const today = startOfDay(now);
  const isDue = (d: Date | null, from: Date, to: Date) => Boolean(d && d >= from && d <= to);
  const devCount = myReqs.filter((r) => r.status === "dev_in_progress").length;
  const testing = myReqs.filter(
    (r) => (r.status === "test_todo" || r.status === "test_in_progress") && r.assignees.some((a) => a.userId === user.id && a.role === "qa"),
  );
  const testingToday = testing.filter((r) => r.plannedEndAt && isToday(r.plannedEndAt)).length;
  const dueWeek = myReqs.filter((r) => isDue(r.plannedEndAt, weekStart, weekEnd));
  const overdue = myReqs.filter((r) => r.plannedEndAt && r.plannedEndAt < today).length;
  const severe = myBugs.filter((b) => b.severity === "blocker" || b.severity === "critical").length;

  const devKpis = [
    { label: "我负责的需求", value: myReqs.length, note: devCount ? `${devCount} 个开发中` : "暂无开发中", danger: false, href: "/my/requirements" },
    { label: "待我测试", value: testing.length, note: testingToday ? `${testingToday} 个今天到期` : "今天没有到期", danger: false, href: "/my/requirements?stage=test" },
    { label: "本周到期", value: dueWeek.length, note: overdue ? `${overdue} 个已逾期` : "没有逾期", danger: overdue > 0, href: "/my/requirements" },
    { label: "我的 Bug", value: myBugs.length, note: myBugs.length ? (severe ? `${severe} 个严重` : "均为一般") : "没有待处理", danger: false, href: "/my/bugs" },
  ];
  const kpis = extras ? extras.kpis : devKpis;

  return (
    <div className="page-overview">
      <header className="page-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/wave.jpg" alt="" aria-hidden="true" className="wv-only wv-hero-mascot" />
        <h1 className="page-title">
          {greeting(now)}，{user.name}
        </h1>
        <p className="page-summary">
          {format(now, "M 月 d 日 EEEE", { locale: zhCN })}
          {dueWeek.length ? ` · 本周还有 ${dueWeek.length} 个需求到期` : ""}
        </p>
      </header>

      <section className="page-section" aria-labelledby="kpi-title">
        <div className="section-head">
          <h2 id="kpi-title" className="section-title">概览</h2>
          <span className="nv-tag is-neutral" title="按你的角色和岗位选择；岗位在「成员管理」里调整">{LAYOUT_LABEL[layout]}版</span>
        </div>
        <div className="kpi-grid">
          {kpis.map((k) => (
            <Link key={k.label} href={k.href} className="kpi-card">
              <span className="kpi-label">{k.label}</span>
              <span className={`kpi-value${k.danger ? " kpi-danger" : ""}`}>{k.value}</span>
              <span className="kpi-note">{k.note}</span>
            </Link>
          ))}
        </div>
      </section>

      {extras ? (
        <section className="page-section" aria-labelledby="role-title">
          <div className="section-head">
            <h2 id="role-title" className="section-title">
              {extras.listTitle}
              <span className="section-count">{extras.rows.length}</span>
            </h2>
            <Link href={extras.more.href} className="btn-secondary nv-section-btn">
              {extras.more.label}
            </Link>
          </div>
          <div className={extras.side ? "nv-wb-split" : undefined}>
            <ul className="nv-models-list">
              {extras.rows.length === 0 ? <li className="nv-models-item nv-ai-note">暂无</li> : null}
              {extras.rows.slice(0, 8).map((r) => (
                <li key={r.id} className="nv-models-item">
                  <div className="nv-models-item-main">
                    <Link href={r.href} className="text-link">
                      <b>{r.name}</b>
                    </Link>
                    <p>{r.meta}</p>
                  </div>
                  {r.progress !== undefined ? (
                    <span className="nv-psum-progress">
                      <span className="nv-progress" aria-hidden="true">
                        <span style={{ width: `${r.progress}%` }} />
                      </span>
                      <span>{r.progress}%</span>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {extras.side ? (
              <div>
                <h3 className="nv-wb-side-title">{extras.side.title}</h3>
                <ul className="nv-models-list">
                  {extras.side.rows.length === 0 ? <li className="nv-models-item nv-ai-note">暂无</li> : null}
                  {extras.side.rows.map((r) => (
                    <li key={r.id} className="nv-models-item">
                      <div className="nv-models-item-main">
                        <Link href={r.href} className="text-link">
                          {r.name}
                        </Link>
                        <p>{r.meta}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="page-section" aria-labelledby="todo-title">
        <div className="section-head">
          <h2 id="todo-title" className="section-title">
            我的工作<span className="section-count">{myReqs.length}</span>
          </h2>
          {myReqs.length ? (
            <Link href="/my/requirements" className="btn-secondary nv-section-btn">
              查看全部
            </Link>
          ) : null}
        </div>
        <div className="card req-table-card nv-overview-list">
          <RequirementPoolTable
            rows={todoRows}
            showProject
            flat
            hideProps={["owner"]}
            canMove={perms["board.move"]}
            emptyTitle="当前没有待处理需求"
            emptyBody={
              <>
                可从 <Link href="/projects" className="text-link">项目</Link> 或{" "}
                <Link href="/requirements" className="text-link">需求池</Link> 继续工作
              </>
            }
          />
        </div>
      </section>

      {tasks.length ? (
        <section className="page-section" aria-labelledby="tasks-title">
          <div className="section-head">
            <h2 id="tasks-title" className="section-title">
              我的任务<span className="section-count">{tasks.length}</span>
            </h2>
          </div>
          <ul className="card nv-proposed-list">
            {tasks.map((t) => {
              const late = t.dueAt && new Date(t.dueAt) < startOfDay(now);
              return (
                <li key={t.id}>
                  <span className="nv-mono">{t.code}</span>
                  <span className="nv-task-kind" data-kind={t.kind}>
                    {isTaskKind(t.kind) ? TASK_KIND_LABEL[t.kind] : t.kind}
                  </span>
                  <Link href={`/requirements/${t.requirement.id}#rq-tasks`} className="nv-proposed-title" title={`${t.requirement.code} ${t.requirement.title}`}>
                    {t.title}
                  </Link>
                  <span className={`nv-proposed-meta${late ? " nv-tests-bad" : ""}`}>
                    {t.requirement.code}
                    {t.project ? ` · ${t.project.name}` : ""}
                    {t.dueAt ? ` · ${late ? "已逾期 " : "截止 "}${format(new Date(t.dueAt), "M 月 d 日")}` : ""}
                  </span>
                  <span className="nv-task-status" data-status={t.status}>
                    {isTaskStatus(t.status) ? TASK_STATUS_LABEL[t.status] : t.status}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {proposed.total ? (
        <section className="page-section" aria-labelledby="proposed-title">
          <div className="section-head">
            <h2 id="proposed-title" className="section-title">
              我提的需求<span className="section-count">{proposed.total}</span>
            </h2>
            <Link href="/requirements?proposer=me" className="btn-secondary nv-section-btn">
              查看全部
            </Link>
          </div>
          <ul className="card nv-proposed-list">
            {proposed.rows.map((r) => (
              <li key={r.id}>
                <Link href={`/requirements/${r.id}`} className="nv-proposed-title">
                  {r.title}
                </Link>
                <span className="nv-proposed-meta">
                  {r.project} · {r.status}
                  {r.children ? ` · 实现需求 ${r.children} 条` : ""}
                  {r.hasDoc ? "" : " · 缺需求文档"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recent.length ? (
        <section className="page-section" aria-labelledby="recent-title">
          <div className="section-head">
            <h2 id="recent-title" className="section-title">最近动态</h2>
          </div>
          <ul className="nv-activity">
            {recent.map((l) => {
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
      ) : null}

    </div>
  );
}
