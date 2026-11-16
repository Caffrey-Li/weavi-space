"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Filter, Search, X } from "lucide-react";

/**
 * 需求池工具栏：标题搜索（Enter 提交）+ 项目 / 状态筛选（选择即生效）。
 * 用 GET 表单驱动 URL，筛选变化时页码自动回到第 1 页。
 */
export function RequirementFilters({
  q,
  stage,
  pageSize,
  project,
  status,
  proposer = "",
  projects,
  statuses,
  hasFilters,
  clearHref,
  showProjectFilter = true,
}: {
  q: string;
  stage?: string;
  pageSize?: string;
  project: string;
  status: string;
  /** 提出人：""（全部）| "me"（我提出的） */
  proposer?: string;
  projects: { id: string; name: string }[];
  statuses: { key: string; label: string }[];
  hasFilters: boolean;
  clearHref: string;
  showProjectFilter?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState(q);
  const submit = () => form.current?.requestSubmit();

  return (
    <form ref={form} className="req-filters" role="search" aria-label="筛选需求">
      {stage ? <input type="hidden" name="stage" value={stage} /> : null}
      {pageSize && pageSize !== "100" ? <input type="hidden" name="pageSize" value={pageSize} /> : null}
      {!showProjectFilter && project ? <input type="hidden" name="project" value={project} /> : null}
      <div className="search-field">
        <Search size={16} aria-hidden="true" className="search-field-icon" />
        <input
          name="q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索需求标题"
          aria-label="搜索需求标题"
          className="input search-field-input"
          enterKeyHint="search"
        />
        {query ? (
          <button
            type="button"
            className="search-field-clear"
            aria-label="清除搜索"
            onClick={() => {
              setQuery("");
              requestAnimationFrame(submit);
            }}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      {showProjectFilter ? (
        <label className="select-field">
          <Filter size={14} aria-hidden="true" className="select-field-icon" />
          <span className="sr-only">项目</span>
          <select name="project" defaultValue={project} className="input select-field-input" onChange={submit}>
            <option value="">全部项目</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="select-field">
        <Filter size={14} aria-hidden="true" className="select-field-icon" />
        <span className="sr-only">提出人</span>
        <select name="proposer" defaultValue={proposer} className="input select-field-input" onChange={submit}>
          <option value="">全部提出人</option>
          <option value="me">我提出的</option>
        </select>
      </label>
      <label className="select-field">
        <Filter size={14} aria-hidden="true" className="select-field-icon" />
        <span className="sr-only">状态</span>
        <select name="status" defaultValue={status} className="input select-field-input" onChange={submit}>
          <option value="">全部状态</option>
          {statuses.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {hasFilters ? (
        <Link href={clearHref} className="btn-ghost req-clear">
          清除筛选
        </Link>
      ) : null}
    </form>
  );
}
