"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Rocket } from "lucide-react";
import { planDates, planTone, shortDay, type PlanRow } from "@/lib/release-plans-shared";

function Progress({ p, wide }: { p: PlanRow; wide?: boolean }) {
  const full = p.total > 0 && p.done === p.total;
  return (
    <div className={`nv-plan-prog${wide ? " is-wide" : ""}`}>
      <div className="nv-plan-prog-label">
        <span>实际完成</span>
        <span className="flex-1" />
        <b>
          {p.done} / {p.total}
        </b>
        <span>{p.pct}%</span>
      </div>
      <div className="nv-plan-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct} aria-label={`${p.version} 实际完成 ${p.pct}%`}>
        <span className={full ? "is-full" : undefined} style={{ width: `${p.pct}%` }} />
      </div>
    </div>
  );
}

function Head({ p }: { p: PlanRow }) {
  const tone = planTone(p);
  return (
    <span className="nv-plan-head">
      <span className="nv-plan-title">
        <code>{p.version}</code>
        {p.title ? <b>{p.title}</b> : null}
        <span className={`nv-tag is-dot is-${tone.tone}`}>{tone.label}</span>
      </span>
      <small>{planDates(p)}</small>
    </span>
  );
}

/** 项目概览里的「上线计划」列表（Figma 04）：每个计划一行，显示实际完成进度 */
export function PlanTimeline({ plans }: { plans: PlanRow[] }) {
  return (
    <div className="nv-plan-list">
      {plans.map((p) => (
        <Link key={p.id} href={`/releases/${p.id}`} className="nv-plan-row">
          <Rocket size={16} aria-hidden="true" className="nv-plan-icon" />
          <Head p={p} />
          <Progress p={p} />
        </Link>
      ))}
    </div>
  );
}

function ReqList({ title, reqs, done }: { title: string; reqs: PlanRow["doneReqs"]; done: boolean }) {
  return (
    <div className="nv-plan-reqs">
      <p className="nv-plan-reqs-head">
        {title}
        <span>{reqs.length}</span>
      </p>
      {reqs.length ? (
        <ul>
          {reqs.map((q) => (
            <li key={q.id}>
              <code>{q.code}</code>
              <Link href={`/requirements/${q.id}`} title={q.title}>
                {q.title}
              </Link>
              <small className={done ? undefined : "is-open"}>{done ? shortDay(q.doneAt) || "已上线" : q.statusLabel}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="nv-plan-reqs-empty">{done ? "还没有完成的需求" : "计划内需求都已完成"}</p>
      )}
    </div>
  );
}

/** 项目「上线计划」页（Figma 35）：每个计划一张卡片，展开看已完成 / 未完成需求 */
export function PlanCards({ plans }: { plans: PlanRow[] }) {
  // 默认展开第一个未上线的计划
  const first = plans.find((p) => p.status !== "released") || plans[0];
  const [open, setOpen] = useState<Set<string>>(() => new Set(first ? [first.id] : []));
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="nv-plan-cards">
      {plans.map((p) => {
        const isOpen = open.has(p.id);
        return (
          <section key={p.id} className="nv-plan-card" aria-label={`上线计划 ${p.version}`}>
            <div className="nv-plan-card-head">
              <button type="button" className="nv-plan-toggle" aria-expanded={isOpen} aria-label={isOpen ? `收起 ${p.version}` : `展开 ${p.version}`} onClick={() => toggle(p.id)}>
                {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
              </button>
              <Head p={p} />
              <Link href={`/releases/${p.id}`} className="btn-ghost nv-head-btn">
                发版详情
              </Link>
              <Progress p={p} wide />
            </div>
            {isOpen ? (
              <div className="nv-plan-card-body">
                <ReqList title="已完成" reqs={p.doneReqs} done />
                <ReqList title="未完成" reqs={p.openReqs} done={false} />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
