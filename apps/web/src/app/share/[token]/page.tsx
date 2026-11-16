/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import { loadSharedProject } from "@pm-collab/core/share/service";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "项目进度 · 小围空间", robots: { index: false, follow: false } };

const PRIORITY: Record<string, string> = { p0: "紧急", p1: "高", p2: "中", p3: "低" };

/** 项目只读分享页（不需要登录）：令牌无效、过期、作废都显示同一个提示，不区分原因 */
export default async function SharePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const data = await loadSharedProject(token);
  if (!data) {
    return (
      <main className="wv-share-page">
        <div className="wv-share-gone">
          <img src="/brand/search.jpg" alt="" aria-hidden="true" />
          <h1>链接已失效</h1>
          <p>这个分享链接不存在、已过期或已被作废，请向分享给你的人要一个新链接。</p>
        </div>
      </main>
    );
  }
  const { project, total, done, progress, stages, requirements, releases, expiresAt } = data;
  return (
    <main className="wv-share-page">
      <header className="wv-share-brand">
        <img src="/brand/icon-64.png" alt="" aria-hidden="true" />
        <span>小围空间 · 项目进度分享</span>
        <em>只读{expiresAt ? ` · ${fmtDate(expiresAt)} 前有效` : ""}</em>
      </header>
      <section className="wv-share-hero">
        <h1>{project.name}</h1>
        {project.description ? <p>{project.description}</p> : null}
        <div className="wv-share-kpis">
          <div>
            <b>{progress}%</b>
            <span>上线完成率</span>
          </div>
          <div>
            <b>
              {done} / {total}
            </b>
            <span>已上线 / 需求总数</span>
          </div>
          <div>
            <b>{project.plannedEndAt ? fmtDate(project.plannedEndAt) : "未设置"}</b>
            <span>计划交付</span>
          </div>
        </div>
        <div className="wv-share-bar" role="img" aria-label={`上线完成率 ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        {stages.length ? (
          <ul className="wv-share-stages">
            {stages.map((s) => (
              <li key={s.key}>
                {s.label} <b>{s.count}</b>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="wv-share-section" aria-labelledby="share-reqs">
        <h2 id="share-reqs">
          需求 <span>{total}</span>
        </h2>
        {requirements.length ? (
          <table className="wv-share-table">
            <thead>
              <tr>
                <th>需求</th>
                <th>状态</th>
                <th>优先级</th>
                <th>计划完成</th>
              </tr>
            </thead>
            <tbody>
              {requirements.map((r, i) => (
                <tr key={i}>
                  <td>{r.title}</td>
                  <td>
                    <span className={`wv-share-status is-${r.status}`}>{r.statusLabel}</span>
                  </td>
                  <td>{PRIORITY[r.priority] || r.priority}</td>
                  <td>{r.plannedEndAt ? fmtDate(r.plannedEndAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="wv-share-empty">还没有需求。</p>
        )}
      </section>

      {releases.length ? (
        <section className="wv-share-section" aria-labelledby="share-rel">
          <h2 id="share-rel">
            发版计划 <span>{releases.length}</span>
          </h2>
          <ul className="wv-share-releases">
            {releases.map((r, i) => (
              <li key={i}>
                <b>{r.version}</b>
                <span>{r.title || ""}</span>
                <em>{r.statusLabel}</em>
                <time>{r.releasedAt ? `${fmtDate(r.releasedAt)} 上线` : r.plannedAt ? `计划 ${fmtDate(r.plannedAt)}` : ""}</time>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <footer className="wv-share-foot">由小围空间生成的只读页面，数据实时更新</footer>
    </main>
  );
}
