"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";

type Info = { scopes: { id: string; name: string }[]; scope: string; configured: boolean; last: { at: string; message: string | null } | null };
type Plan = {
  deptCreate: { externalId: string; name: string }[];
  deptRename: { orgId: string; from: string; to: string }[];
  deptMissing: { orgId: string; name: string }[];
  userBind: { userId: string; name: string }[];
  userCreate: { externalId: string; name: string; email: string }[];
  userMove: { userId: string; name: string }[];
  userDeactivate: { userId: string; name: string }[];
  skipped: string[];
};
type Preview = { summary: Record<string, number>; plan: Plan };

const fmt = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** T40：先「预览」看会改什么，再「同步」；选项默认只建部门、绑定已有账号 */
export function OrgSyncPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const id = useId();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [options, setOptions] = useState({ createUsers: false, moveUsers: false, deactivate: false });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "apply">("");

  const load = useCallback(async (scope?: string) => {
    const r = await fetch(`/api/system/org-sync${scope !== undefined ? `?scope=${encodeURIComponent(scope)}` : ""}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(d.error || "读取失败");
    setInfo(d);
    setPreview(null);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!info) return error ? <p className="nv-set-error">{error}</p> : <p className="nv-set-hint">正在读取…</p>;

  async function run(apply: boolean) {
    if (!info) return;
    if (apply && !(await confirm({ title: "按预览同步组织架构？", body: `会在「${info.scopes.find((s) => s.id === info.scope)?.name}」里新建 / 改名部门、绑定飞书身份${options.createUsers ? "、新建账号" : ""}${options.moveUsers ? "、调整成员部门" : ""}${options.deactivate ? "、停用飞书已离职的账号" : ""}。不会删除任何部门或账号。`, confirmLabel: "同步" }))) return;
    setBusy(apply ? "apply" : "preview");
    const r = await fetch("/api/system/org-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: info.scope, apply, options }) });
    const d = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok) return toast.error(d.error || "失败");
    if (apply) {
      toast.success(d.message || "已同步");
      void load(info.scope);
    } else setPreview(d as Preview);
  }

  const p = preview?.plan;
  const section = (title: string, items: string[]) =>
    items.length ? (
      <div className="nv-osync-sec">
        <p>
          <b>{title}</b> {items.length}
        </p>
        <p className="nv-osync-items">{items.slice(0, 30).join("、")}{items.length > 30 ? ` 等 ${items.length} 项` : ""}</p>
      </div>
    ) : null;

  return (
    <>
      {info.scopes.length > 1 ? (
        <label className="nv-loginmgr-scope" htmlFor={`${id}-scope`}>
          <span>企业</span>
          <select id={`${id}-scope`} className="input" value={info.scope} onChange={(e) => void load(e.target.value)}>
            {info.scopes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <section className="nv-itr-card nv-ai-card" aria-labelledby={`${id}-t`}>
        <div className="nv-itr-head">
          <div className="min-w-0 flex-1">
            <p className="nv-itr-title" id={`${id}-t`}>
              同步设置
            </p>
            <p className="nv-itr-sub">{info.last ? `上次同步 ${fmt(info.last.at)} · ${info.last.message || ""}` : "还没有同步过"}</p>
          </div>
          <span className={`nv-tag is-dot ${info.configured ? "is-success" : "is-neutral"}`}>{info.configured ? "飞书应用已配置" : "未配置飞书应用"}</span>
        </div>
        {!info.configured ? (
          <p className="nv-set-hint">
            先在{" "}
            <Link className="text-link" href="/system/login">
              登录管理
            </Link>{" "}
            里为本企业填写飞书企业自建应用的 App ID 和 App Secret，并在飞书开发者后台开通通讯录只读权限（部门、成员、邮箱、手机号），通讯录权限范围选全部成员。
          </p>
        ) : (
          <div className="nv-set-form nv-ai-form">
            <div className="nv-agents-perms">
              <label>
                <input type="checkbox" checked={options.createUsers} onChange={(e) => { setOptions({ ...options, createUsers: e.target.checked }); setPreview(null); }} />
                本企业没有的成员，新建账号（没有密码，用飞书登录；角色「成员」）
              </label>
              <label>
                <input type="checkbox" checked={options.moveUsers} onChange={(e) => { setOptions({ ...options, moveUsers: e.target.checked }); setPreview(null); }} />
                按飞书部门调整成员的所属部门
              </label>
              <label>
                <input type="checkbox" checked={options.deactivate} onChange={(e) => { setOptions({ ...options, deactivate: e.target.checked }); setPreview(null); }} />
                飞书里已离职 / 冻结的成员，停用账号
              </label>
            </div>
            <small className="nv-set-hint">部门总是会同步（新建、改名，不删除）；已有账号按企业邮箱匹配并绑定飞书登录。系统管理员、企业超管和你自己的账号不会被调整或停用。</small>
            <div className="nv-bot-ops">
              <button type="button" className="btn-secondary nv-head-btn" disabled={Boolean(busy)} onClick={() => void run(false)}>
                {busy === "preview" ? "正在读取飞书通讯录…" : "预览"}
              </button>
              <button type="button" className="btn-primary nv-head-btn" disabled={Boolean(busy) || !preview} onClick={() => void run(true)} title={preview ? undefined : "先预览"}>
                {busy === "apply" ? "同步中…" : "同步"}
              </button>
            </div>
          </div>
        )}
      </section>
      {preview && p ? (
        <section className="nv-itr-card nv-ai-card" aria-label="预览结果">
          <div className="nv-itr-head">
            <div className="min-w-0 flex-1">
              <p className="nv-itr-title">预览</p>
              <p className="nv-itr-sub">
                飞书有 {preview.summary.depts} 个部门、{preview.summary.users} 位成员。点「同步」按下面执行。
              </p>
            </div>
          </div>
          {section("新建部门", p.deptCreate.map((d) => d.name))}
          {section("部门改名", p.deptRename.map((d) => `${d.from} → ${d.to}`))}
          {section("飞书已没有的部门（不删除）", p.deptMissing.map((d) => d.name))}
          {section("绑定飞书身份", p.userBind.map((u) => u.name))}
          {section("新建账号", p.userCreate.map((u) => `${u.name}（${u.email}）`))}
          {section("调整所属部门", p.userMove.map((u) => u.name))}
          {section("停用账号", p.userDeactivate.map((u) => u.name))}
          {section("跳过", p.skipped)}
          {Object.entries(preview.summary).every(([k, v]) => k === "depts" || k === "users" || !v) ? <p className="nv-set-hint">已经和飞书一致，没有要改的。</p> : null}
        </section>
      ) : null}
    </>
  );
}
