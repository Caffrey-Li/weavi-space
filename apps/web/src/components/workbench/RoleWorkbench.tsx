import Link from "next/link";
import type { RoleWorkbench as Data, WbBlock, WbRow, WbSideCard } from "@pm-collab/core/workbench/role-workbench";
import { WB_ROLE_CHIP, WB_ROLE_LABEL, groupInbox, type InboxItem, type WbRole } from "@pm-collab/core/workbench/roles";

/** 角色标签：颜色按角色区分（globals.css .nv-wb-role[data-role]） */
export function RoleChip({ role }: { role: WbRole }) {
  return (
    <span className="nv-wb-role" data-role={role} title={WB_ROLE_LABEL[role]}>
      {WB_ROLE_CHIP[role]}
    </span>
  );
}

const TONE: Record<string, string> = { danger: "is-danger", warning: "is-warning", info: "is-info", neutral: "is-neutral" };

/** 问候下面那句话：单角色说最要紧的事；多角色先说在哪些项目担任什么 */
export function summaryLine(d: Data) {
  const blocking = d.inbox.filter((i) => i.urgency === 0).length;
  const today = d.inbox.filter((i) => i.urgency === 1).length;
  const tail = [blocking ? `${blocking} 件事卡着别人或已逾期` : "", today ? `${today} 件今天要处理` : ""].filter(Boolean).join("，");
  if (d.roles.length > 1) {
    const parts = d.roleProjects
      .filter((r) => r.role !== "manager" && r.role !== "admin")
      .map((r) => (r.projects.length ? `在${r.projects.slice(0, 2).join("、")}${r.projects.length > 2 ? ` 等 ${r.projects.length} 个项目` : ""}是${WB_ROLE_LABEL[r.role]}` : `是${WB_ROLE_LABEL[r.role]}`));
    const admin = d.roles.filter((r) => r === "manager" || r === "admin").map((r) => `也是${WB_ROLE_LABEL[r]}`);
    return `你${[...parts, ...admin].join("，")}${tail ? ` · ${tail}` : ""}`;
  }
  return tail || "卡在你这里的事都处理完了";
}

function Inbox({ items, multi }: { items: InboxItem[]; multi: boolean }) {
  const groups = groupInbox(items);
  return (
    <section className="nv-wb-card is-inbox" aria-labelledby="wb-inbox">
      <div className="nv-wb-card-head">
        <h2 id="wb-inbox">待我处理</h2>
        <span className="section-count">{items.length}</span>
      </div>
      {!items.length ? <p className="nv-wb-empty">都处理完了</p> : null}
      {groups.map((g) => (
        <div key={g.urgency} className="nv-wb-group">
          {groups.length > 1 || g.urgency === 0 ? <h3 className="nv-wb-group-title">{g.label}</h3> : null}
          <ul className="nv-wb-rows">
            {g.items.map((it) => (
              <li key={it.key} className="nv-wb-row">
                {multi ? <RoleChip role={it.role} /> : null}
                <span className={`nv-tag ${TONE[it.tone || "neutral"]}`}>{it.kind}</span>
                <span className="nv-wb-row-main">
                  <Link href={it.href} className="nv-wb-row-title" title={it.title}>
                    {it.title}
                  </Link>
                  {it.meta ? <span className="nv-wb-row-meta">{it.meta}</span> : null}
                </span>
                <Link href={it.href} className={g.urgency <= 1 ? "btn-primary nv-head-btn" : "btn-secondary nv-head-btn"}>
                  {it.action}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Rows({ rows }: { rows: WbRow[] }) {
  return (
    <ul className="nv-wb-rows">
      {rows.map((r, i) => (
        // 同一条需求可能同时「逾期」又「待测过久」，id 会重复，key 带上标签和序号
        <li key={`${r.id}:${r.tag || ""}:${i}`} className="nv-wb-row">
          {r.tag ? <span className={`nv-tag ${TONE[r.tone || "neutral"]}`}>{r.tag}</span> : null}
          <span className="nv-wb-row-main">
            <Link href={r.href} className="nv-wb-row-title" title={r.title}>
              {r.title}
            </Link>
            {r.meta ? <span className="nv-wb-row-meta">{r.meta}</span> : null}
          </span>
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
  );
}

function Block({ b, multi }: { b: WbBlock; multi: boolean }) {
  return (
    <section className="nv-wb-card" aria-labelledby={`wb-${b.key}`}>
      <div className="nv-wb-card-head">
        {multi ? <RoleChip role={b.role} /> : null}
        <h2 id={`wb-${b.key}`}>{b.title}</h2>
        <span className="section-count">{b.count}</span>
        {b.more ? (
          <Link href={b.more.href} className="text-link nv-wb-more">
            {b.more.label} →
          </Link>
        ) : null}
      </div>
      {b.rows.length ? <Rows rows={b.rows} /> : <p className="nv-wb-empty">{b.empty}</p>}
    </section>
  );
}

function Side({ c }: { c: WbSideCard }) {
  return (
    <section className="nv-wb-card is-side" aria-labelledby={`wb-side-${c.key}`}>
      <div className="nv-wb-card-head">
        <h2 id={`wb-side-${c.key}`}>{c.title}</h2>
        {c.more ? (
          <Link href={c.more.href} className="text-link nv-wb-more">
            {c.more.label} →
          </Link>
        ) : null}
      </div>
      {c.rows.length ? (
        <ul className="nv-wb-side-rows">
          {c.rows.map((r, i) => (
            <li key={`${r.id}:${r.tag || ""}:${i}`}>
              <Link href={r.href} className="nv-wb-row-title" title={r.title}>
                {r.title}
              </Link>
              {r.meta ? <span className="nv-wb-row-meta">{r.meta}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="nv-wb-empty">暂无</p>
      )}
    </section>
  );
}

/** 工作台主体（Figma 95）：4 指标 + 主栏（待我处理、各角色主区块）+ 右侧 300 侧栏 */
export function RoleWorkbenchBody({ data, extraSide }: { data: Data; extraSide?: React.ReactNode }) {
  const multi = data.roles.length > 1;
  return (
    <>
      <div className="kpi-grid nv-wb-kpis">
        {data.kpis.map((k) => (
          <Link key={`${k.role}:${k.label}`} href={k.href} className="kpi-card">
            <span className="kpi-label">
              {k.label}
              {multi ? <span className="nv-wb-kpi-role"> · {WB_ROLE_CHIP[k.role]}</span> : null}
            </span>
            <span className={`kpi-value${k.danger ? " kpi-danger" : ""}`}>{k.value}</span>
            <span className="kpi-note">{k.note}</span>
          </Link>
        ))}
      </div>
      <div className="nv-wb-body">
        <div className="nv-wb-main">
          <Inbox items={data.inbox} multi={multi} />
          {data.blocks.map((b) => (
            <Block key={b.key} b={b} multi={multi} />
          ))}
        </div>
        <aside className="nv-wb-side" aria-label="侧栏">
          {data.side.map((c) => (
            <Side key={c.key} c={c} />
          ))}
          {extraSide}
        </aside>
      </div>
    </>
  );
}
