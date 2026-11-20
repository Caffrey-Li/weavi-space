"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Plus } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { SkillFilesInput, type SkillFile } from "./SkillFilesInput";

type Row = { id: string; name: string; description: string; content: string; files: SkillFile[]; overrides: string | null; overrideMode: string | null; updatedAt: string; editor: string };
type View = { scopes: { id: string; name: string }[]; scope: string; builtin: { key: string; name: string; description: string }[]; skills: Row[] };
type Form = { id?: string; kind: "new" | "custom"; overrides: string; overrideMode: "append" | "replace"; name: string; description: string; content: string; files: SkillFile[] };

const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/**
 * T35 企业 skill 管理：上半部分是内置能力的定制情况（补充企业要求 / 整份替换），下半部分是企业新增的 skill。
 * 系统超管可以切换企业；企业超管只管本企业。
 */
export function EnterpriseSkillsPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const id = useId();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async (scope?: string) => {
    const r = await fetch(`/api/system/skills${scope !== undefined ? `?scope=${encodeURIComponent(scope)}` : ""}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(d.error || "读取失败");
    setView(d as View);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!view) return error ? <p className="nv-set-error">{error}</p> : <p className="nv-set-hint">正在读取…</p>;
  const custom = new Map(view.skills.filter((s) => s.overrides).map((s) => [s.overrides!, s]));
  const added = view.skills.filter((s) => !s.overrides);

  const edit = (r: Row) => {
    setFormError("");
    setForm({ id: r.id, kind: r.overrides ? "custom" : "new", overrides: r.overrides || "", overrideMode: r.overrideMode === "replace" ? "replace" : "append", name: r.name, description: r.description, content: r.content, files: r.files });
  };
  const customize = (key: string) => {
    const hit = custom.get(key);
    if (hit) return edit(hit);
    setFormError("");
    setForm({ kind: "custom", overrides: key, overrideMode: "append", name: "", description: "", content: "", files: [] });
  };

  async function save() {
    if (!form || !view) return;
    setBusy(true);
    setFormError("");
    const r = await fetch("/api/system/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: view.scope, id: form.id, name: form.name, description: form.description, content: form.content, files: form.files, overrides: form.kind === "custom" ? form.overrides : null, overrideMode: form.overrideMode }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setFormError(d.error || "保存失败");
    setForm(null);
    toast.success("已保存，本企业成员立即生效");
    void load(view.scope);
  }

  async function remove(r: Row) {
    if (!view) return;
    if (!(await confirm({ title: r.overrides ? `取消对「${r.name}」的定制？` : `删除「${r.name}」？`, body: r.overrides ? "取消后成员用回系统内置的说明。" : "删除后本企业成员不能再用这个 skill；需求交付里已经生成的内容不受影响。", confirmLabel: r.overrides ? "取消定制" : "删除", tone: "danger" }))) return;
    const res = await fetch(`/api/system/skills?scope=${encodeURIComponent(view.scope)}&id=${r.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("已处理");
      void load(view.scope);
    } else toast.error("操作失败");
  }

  const builtinName = (key: string) => view.builtin.find((b) => b.key === key)?.name || key;

  return (
    <>
      {view.scopes.length > 1 ? (
        <label className="nv-loginmgr-scope" htmlFor={`${id}-scope`}>
          <span>管理范围</span>
          <select id={`${id}-scope`} className="input" value={view.scope} onChange={(e) => void load(e.target.value)}>
            {view.scopes.map((s) => (
              <option key={s.id || "system"} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <section className="nv-itr-card nv-ai-card" aria-labelledby={`${id}-b`}>
        <div className="nv-itr-head">
          <div className="min-w-0 flex-1">
            <p className="nv-itr-title" id={`${id}-b`}>
              定制内置能力
            </p>
            <p className="nv-itr-sub">「补充要求」会在内置说明后追加企业的规范（如必填章节、评审口径）；「替换」会整份换成企业自己的模板。</p>
          </div>
        </div>
        <ul className="nv-eskill-list">
          {view.builtin.map((b) => {
            const c = custom.get(b.key);
            return (
              <li key={b.key} className="nv-eskill-item">
                <div>
                  <b>{b.name}</b> {c ? <span className="nv-tag is-info">{c.overrideMode === "replace" ? "已替换" : "已补充要求"}</span> : null}
                  <p>{c ? `${c.editor} · ${day(c.updatedAt)} 更新${c.files.length ? ` · ${c.files.length} 个参考文件` : ""}` : b.description}</p>
                </div>
                <button type="button" className="btn-secondary nv-head-btn" onClick={() => customize(b.key)}>
                  {c ? "修改" : "定制"}
                </button>
                {c ? (
                  <button type="button" className="btn-ghost nv-head-btn" onClick={() => void remove(c)}>
                    取消定制
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="nv-itr-card nv-ai-card" aria-labelledby={`${id}-n`}>
        <div className="nv-itr-head">
          <div className="min-w-0 flex-1">
            <p className="nv-itr-title" id={`${id}-n`}>
              企业新增 <span className="section-count">{added.length}</span>
            </p>
            <p className="nv-itr-sub">本企业所有人在个人能力、需求交付（生成 PRD、测试用例、测试报告时可选）和 MCP 里都能用。</p>
          </div>
          <button type="button" className="btn-primary nv-head-btn" onClick={() => { setFormError(""); setForm({ kind: "new", overrides: "", overrideMode: "append", name: "", description: "", content: "", files: [] }); }}>
            <Plus size={14} aria-hidden="true" />
            新增企业 skill
          </button>
        </div>
        {added.length ? (
          <ul className="nv-eskill-list">
            {added.map((r) => (
              <li key={r.id} className="nv-eskill-item">
                <div>
                  <b>{r.name}</b>
                  <p>{[r.description, `${r.editor} · ${day(r.updatedAt)} 更新`, r.files.length ? `${r.files.length} 个参考文件` : ""].filter(Boolean).join(" · ")}</p>
                </div>
                <button type="button" className="btn-secondary nv-head-btn" onClick={() => edit(r)}>
                  修改
                </button>
                <button type="button" className="btn-ghost nv-head-btn" onClick={() => void remove(r)}>
                  删除
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nv-set-hint">还没有企业 skill。可以把企业的 PRD 模板、评审清单、测试报告格式写成 SKILL.md 上传。</p>
        )}
      </section>

      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.kind === "custom" ? `定制内置能力 · ${builtinName(form.overrides)}` : form?.id ? "修改企业 skill" : "新增企业 skill"} busy={busy} dirty={Boolean(form?.content)} wide>
        {form ? (
          <div className="nv-pform">
            <div className="nv-pform-body">
              {formError ? (
                <div role="alert" className="banner-error">
                  {formError}
                </div>
              ) : null}
              {form.kind === "custom" ? (
                <label className="nv-pfield" htmlFor={`${id}-mode`}>
                  <span className="nv-pfield-label">定制方式</span>
                  <select id={`${id}-mode`} className="input" value={form.overrideMode} onChange={(e) => setForm({ ...form, overrideMode: e.target.value as Form["overrideMode"] })}>
                    <option value="append">补充企业要求（保留内置说明，追加在后面，优先级更高）</option>
                    <option value="replace">整份替换（只用下面的说明和参考文件）</option>
                  </select>
                </label>
              ) : (
                <div className="nv-set-grid">
                  <label className="nv-pfield" htmlFor={`${id}-name`}>
                    <span className="nv-pfield-label">名称</span>
                    <input id={`${id}-name`} className="input" value={form.name} maxLength={60} placeholder="不填就读 SKILL.md 的 name" onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </label>
                  <label className="nv-pfield" htmlFor={`${id}-desc`}>
                    <span className="nv-pfield-label">简介</span>
                    <input id={`${id}-desc`} className="input" value={form.description} maxLength={300} placeholder="不填就读 SKILL.md 的 description" onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  </label>
                </div>
              )}
              <label className="nv-pfield" htmlFor={`${id}-c`}>
                <span className="nv-pfield-label">{form.kind === "custom" && form.overrideMode === "append" ? "企业补充要求" : "SKILL.md 内容"}</span>
                <textarea
                  id={`${id}-c`}
                  className="input nv-set-textarea is-code"
                  rows={12}
                  value={form.content}
                  placeholder={form.kind === "custom" && form.overrideMode === "append" ? "例如：PRD 必须包含「数据埋点」「灰度方案」两章；验收标准按 Given / When / Then 写。" : "---\nname: 企业 PRD 模板\ndescription: …\n---\n# 说明…"}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                />
              </label>
              <SkillFilesInput files={form.files} onChange={(files) => setForm({ ...form, files })} />
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note">只按说明文字作答，不执行其中的脚本和工具</span>
              <ModalCancelButton className="btn-secondary nv-head-btn" />
              <button type="button" className="btn-primary nv-head-btn" disabled={busy || form.content.trim().length < 10} onClick={() => void save()}>
                {busy ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
