"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { Copy, Plus, Upload } from "lucide-react";
import { Modal, ModalCancelButton } from "@/components/ui/Modal";
import { RouteTabs } from "@/components/ui/RouteTabs";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { BuiltinSkillUpdates } from "./BuiltinSkillUpdates";

/**
 * 设置 · 个人 · 个人能力（T30，Figma 79 · 98 / 99）：
 * - 能力库：系统内置能力（来自打包的 caffrey-prd-plus / caffrey-test-runner）和我上传的 SKILL.md，卡片展示；「使用」在弹窗里选模型执行，「查看说明」看原文；
 * - API 令牌：MCP / 开放接口用的个人令牌，新建在弹窗里，创建后弹窗复制；列表只显示前后几位。
 */
type Skill = { id: string; name: string; description: string; builtin: boolean; source?: string; size?: number; updatedAt?: string };
type Opt = { credentialId: string; model: string; label: string; disabled: boolean; reason?: string };
type Token = { id: string; name: string; scopes: string[]; createdAt: string; expiresAt: string | null; lastUsedAt: string | null; masked: string; agentConnectionId: string | null };
type Space = { id: string; name: string };
type Detail = { name: string; description: string; builtin: boolean; source?: string; version?: string; task?: string; files?: { path: string; chars: number }[]; content: string };
type Output = { text: string; html: boolean; pageId: string | null; spaceId: string | null };

const READ = ["projects.read", "requirements.read", "bugs.read", "releases.read", "products.read", "docs.read"];
const SCOPE_LABEL: Record<string, string> = {
  "projects.read": "读项目",
  "requirements.read": "读需求",
  "bugs.read": "读 Bug",
  "releases.read": "读发版",
  "products.read": "读产品",
  "docs.read": "读文档",
  "requirements.create": "新建需求",
  "requirements.edit": "编辑需求",
  "board.move": "改需求状态",
  "bugs.edit": "处理 Bug",
  "docs.edit": "编辑文档",
};
/** 内置能力在系统里还用在哪里 */
const USED_IN: Record<string, string> = {
  "builtin:req-analysis": "需求交付 · 生成 PRD 时可选",
  "builtin:prd": "需求交付 · 生成 PRD",
  "builtin:test-cases": "需求交付 · 测试用例",
  "builtin:test-report": "需求交付 · 测试报告",
  "builtin:test-plan": "提测前交给执行 Agent",
  "builtin:prd-review": "评审别人写的 PRD",
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
function ago(iso: string | null) {
  if (!iso) return "从未";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  if (m < 1440) return `${Math.round(m / 60)} 小时前`;
  return `${Math.round(m / 1440)} 天前`;
}
function scopeSummary(scopes: string[]) {
  const reads = scopes.filter((s) => READ.includes(s)).length;
  const writes = scopes.filter((s) => !READ.includes(s)).map((s) => SCOPE_LABEL[s] || s);
  return [reads ? `读取 ${reads} 项` : "", ...writes].filter(Boolean).join("、");
}

function CopyButton({ text }: { text: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn-secondary nv-head-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => toast.success("已复制"),
          () => toast.error("复制失败，请手动选中复制"),
        );
      }}
    >
      <Copy size={14} aria-hidden="true" />
      复制
    </button>
  );
}

export function SkillsPanel({ tab }: { tab: "skills" | "tokens" }) {
  return (
    <div className="nv-set nv-ftab nv-skills">
      <header className="nv-set-title">
        <h1>个人能力</h1>
        <p>能力 = 一份 skill 说明 + 你选的模型。内置能力来自系统打包的 caffrey-prd-plus 和 caffrey-test-runner，你也可以上传自己的 SKILL.md。需求交付和本机 Agent（MCP）用的也是这些能力。</p>
      </header>
      <RouteTabs
        label="个人能力"
        current={tab}
        tabs={[
          { key: "skills", label: "能力库", href: "/settings/skills" },
          { key: "tokens", label: "API 令牌", href: "/settings/skills?tab=tokens" },
        ]}
      />
      {tab === "tokens" ? <TokensTab /> : <SkillsTab />}
    </div>
  );
}

// ---------- 能力库 ----------

function SkillsTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const id = useId();
  const [skills, setSkills] = useState<{ builtin: Skill[]; mine: Skill[] } | null>(null);
  const [opts, setOpts] = useState<Opt[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [using, setUsing] = useState<Skill | null>(null);
  const [viewing, setViewing] = useState<Detail | null>(null);
  const [uploading, setUploading] = useState(false);
  const [upload, setUpload] = useState("");

  const load = useCallback(async () => {
    const [s, m, sp] = await Promise.all([
      fetch("/api/skills", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/ai/models", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/docs/spaces", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ]);
    setSkills(s);
    setOpts(m.options || []);
    if (sp) setSpaces([...(sp.products || []).flatMap((p: { projects: Space[] }) => p.projects), ...(sp.unassigned || [])]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function view(s: Skill) {
    const r = await fetch(`/api/skills/${encodeURIComponent(s.id)}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(d.error || "读取失败");
    setViewing(d);
  }

  async function addSkill() {
    const r = await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: upload }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(d.error || "保存失败");
    toast.success("已添加");
    setUpload("");
    setUploading(false);
    void load();
  }

  const card = (s: Skill) => (
    <li key={s.id} className="nv-skill-card">
      <div className="nv-skill-card-head">
        <b>{s.name}</b>
        <span className={`nv-tag ${s.builtin ? "is-info" : "is-neutral"}`}>{s.builtin ? "内置" : "我的"}</span>
      </div>
      <p>{s.description}</p>
      <small>
        {s.builtin ? [s.source, USED_IN[s.id] ? `用在 ${USED_IN[s.id]}` : ""].filter(Boolean).join(" · ") : `${((s.size || 0) / 1024).toFixed(1)} KB · ${day(s.updatedAt || null)} 更新 · 只按说明文字作答，不执行脚本`}
      </small>
      <div className="nv-skill-card-ops">
        <button type="button" className="btn-primary nv-head-btn" onClick={() => setUsing(s)}>
          使用
        </button>
        <button type="button" className="btn-secondary nv-head-btn" onClick={() => void view(s)}>
          查看说明
        </button>
        {!s.builtin ? (
          <button
            type="button"
            className="btn-ghost nv-head-btn"
            onClick={async () => {
              if (!(await confirm({ title: `删除「${s.name}」？`, confirmLabel: "删除", tone: "danger" }))) return;
              await fetch(`/api/skills/${s.id}`, { method: "DELETE" });
              void load();
            }}
          >
            删除
          </button>
        ) : null}
      </div>
    </li>
  );

  return (
    <>
      <section aria-labelledby={`${id}-b`} className="nv-skill-sec">
        <div className="nv-skill-sec-head">
          <h2 id={`${id}-b`}>
            系统内置 <span className="section-count">{skills?.builtin.length ?? ""}</span>
          </h2>
        </div>
        <BuiltinSkillUpdates onUpdated={() => void load()} />
        {skills ? <ul className="nv-skill-grid">{skills.builtin.map(card)}</ul> : <p className="nv-skills-empty">加载中…</p>}
      </section>
      <section aria-labelledby={`${id}-m`} className="nv-skill-sec">
        <div className="nv-skill-sec-head">
          <h2 id={`${id}-m`}>
            我的 skill <span className="section-count">{skills?.mine.length ?? ""}</span>
          </h2>
          <button type="button" className="btn-secondary nv-head-btn" onClick={() => setUploading(true)}>
            <Upload size={14} aria-hidden="true" />
            上传 SKILL.md
          </button>
        </div>
        {skills && skills.mine.length ? <ul className="nv-skill-grid">{skills.mine.map(card)}</ul> : <p className="nv-skills-empty">还没有上传。把常用的写作模板、检查清单写成 SKILL.md 上传，就能和内置能力一样用。</p>}
      </section>

      <UseSkillModal skill={using} opts={opts} spaces={spaces} onClose={() => setUsing(null)} />

      <Modal open={Boolean(viewing)} onClose={() => setViewing(null)} title={viewing ? `说明 · ${viewing.name}` : ""} wide>
        {viewing ? (
          <div className="nv-pform">
            <div className="nv-pform-body">
              <p className="nv-pform-intro">{viewing.description}</p>
              {viewing.builtin ? (
                <dl className="nv-skills-kv">
                  <div>
                    <dt>来源</dt>
                    <dd>
                      {viewing.source} v{viewing.version}（系统内置，随系统升级）
                    </dd>
                  </div>
                  <div>
                    <dt>这项能力</dt>
                    <dd>{viewing.task}</dd>
                  </div>
                  <div>
                    <dt>用到的文件</dt>
                    <dd>{(viewing.files || []).map((f) => `${f.path}（${f.chars.toLocaleString()} 字）`).join("、")}</dd>
                  </div>
                </dl>
              ) : null}
              <pre className="nv-skill-text">{viewing.content}</pre>
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note" />
              <ModalCancelButton className="btn-secondary nv-head-btn">关闭</ModalCancelButton>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={uploading} onClose={() => setUploading(false)} title="上传 SKILL.md" dirty={Boolean(upload.trim())}>
        <div className="nv-pform">
          <div className="nv-pform-body">
            <p className="nv-pform-intro">粘贴 SKILL.md 全文，frontmatter 里的 name / description 会自动读取。系统只按说明文字作答，不执行其中的脚本和工具。</p>
            <label className="nv-pfield" htmlFor={`${id}-up`}>
              <span className="nv-pfield-label">SKILL.md 内容</span>
              <textarea id={`${id}-up`} className="input nv-set-textarea is-code" rows={12} value={upload} placeholder={"---\nname: my-skill\ndescription: …\n---\n# 说明…"} onChange={(e) => setUpload(e.target.value)} />
            </label>
          </div>
          <div className="nv-pform-foot">
            <span className="nv-pform-note" />
            <ModalCancelButton className="btn-secondary nv-head-btn" />
            <button type="button" className="btn-primary nv-head-btn" disabled={upload.trim().length < 20} onClick={() => void addSkill()}>
              保存
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function UseSkillModal({ skill, opts, spaces, onClose }: { skill: Skill | null; opts: Opt[]; spaces: Space[]; onClose: () => void }) {
  return (
    <Modal open={Boolean(skill)} onClose={onClose} title={skill ? `使用 · ${skill.name}` : ""} wide>
      {skill ? <UseSkillForm key={skill.id} skill={skill} opts={opts} spaces={spaces} /> : null}
    </Modal>
  );
}

function UseSkillForm({ skill, opts, spaces }: { skill: Skill; opts: Opt[]; spaces: Space[] }) {
  const toast = useToast();
  const id = useId();
  const okOpts = opts.filter((o) => !o.disabled);
  const [pick, setPick] = useState("");
  const [input, setInput] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Output | null>(null);
  const value = pick || (okOpts[0] ? `${okOpts[0].credentialId}|${okOpts[0].model}` : "");

  async function execute() {
    if (busy) return;
    const [credentialId, model] = value.split("|");
    if (!credentialId) return toast.error("请先在「模型管理」添加模型");
    setBusy(true);
    setOut(null);
    const r = await fetch("/api/skills/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skillId: skill.id, input, credentialId, model, spaceId: spaceId || undefined }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast.error(d.error || "执行失败");
    setOut(d);
  }

  const download = () => {
    if (!out) return;
    const blob = new Blob([out.text], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "prototype.html";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="nv-pform">
      <div className="nv-pform-body">
        <p className="nv-pform-intro">{skill.builtin ? `${skill.source} · ${skill.description}` : skill.description}</p>
        <label className="nv-pfield" htmlFor={`${id}-md`}>
          <span className="nv-pfield-label">模型</span>
          <select id={`${id}-md`} className="input" value={value} onChange={(e) => setPick(e.target.value)}>
            {opts.length === 0 ? <option value="">还没有模型</option> : null}
            {opts.map((o) => (
              <option key={`${o.credentialId}|${o.model}`} value={`${o.credentialId}|${o.model}`} disabled={o.disabled}>
                {o.label}
                {o.disabled ? "（token 不足）" : ""}
              </option>
            ))}
          </select>
          {opts.length === 0 ? (
            <small>
              到 <Link href="/settings/models" className="text-link">模型管理</Link> 添加并测试
            </small>
          ) : null}
        </label>
        <label className="nv-pfield" htmlFor={`${id}-in`}>
          <span className="nv-pfield-label">输入</span>
          <textarea id={`${id}-in`} className="input nv-set-textarea" rows={7} maxLength={20000} value={input} placeholder="粘贴需求描述、会议纪要、PRD 或测试结果…" onChange={(e) => setInput(e.target.value)} />
        </label>
        <label className="nv-pfield" htmlFor={`${id}-sp`}>
          <span className="nv-pfield-label">结果存到文档空间（可选）</span>
          <select id={`${id}-sp`} className="input" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
            <option value="">不保存</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {out ? (
          <div className="nv-skill-out">
            <div className="nv-bot-ops">
              <CopyButton text={out.text} />
              {out.html ? (
                <button type="button" className="btn-secondary nv-head-btn" onClick={download}>
                  下载 HTML
                </button>
              ) : null}
              {out.pageId ? (
                <Link href={`/docs/${out.spaceId}/pages/${out.pageId}`} className="btn-secondary nv-head-btn">
                  打开文档
                </Link>
              ) : null}
            </div>
            {out.html ? <iframe title="原型预览" className="nv-skill-frame" sandbox="" srcDoc={out.text} /> : null}
            <pre className="nv-skill-text">{out.text}</pre>
          </div>
        ) : null}
      </div>
      <div className="nv-pform-foot">
        <span className="nv-pform-note">{busy ? "执行中，长内容可能要 1～2 分钟…" : ""}</span>
        <ModalCancelButton className="btn-secondary nv-head-btn">{out ? "关闭" : "取消"}</ModalCancelButton>
        <button type="button" className="btn-primary nv-head-btn" disabled={busy || !input.trim() || !value} aria-busy={busy || undefined} onClick={() => void execute()}>
          {busy ? "执行中…" : out ? "再执行一次" : "执行"}
        </button>
      </div>
    </div>
  );
}

// ---------- API 令牌 ----------

function TokensTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const id = useId();
  const [data, setData] = useState<{ tokens: Token[]; scopes: string[] } | null>(null);
  const [origin, setOrigin] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", scopes: [...READ] as string[], days: 90 });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ token: string; name: string; scopes: string[]; days: number } | null>(null);

  const load = useCallback(async () => {
    setData(await fetch("/api/me/tokens", { cache: "no-store" }).then((r) => r.json()));
  }, []);
  useEffect(() => {
    void load();
    setOrigin(window.location.origin);
  }, [load]);

  async function create() {
    setBusy(true);
    const r = await fetch("/api/me/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast.error(d.error || "创建失败");
    setCreating(false);
    setCreated({ token: d.token, name: form.name, scopes: form.scopes, days: form.days });
    setForm({ name: "", scopes: [...READ], days: 90 });
    void load();
  }

  async function revoke(t: Token) {
    if (!(await confirm({ title: `吊销令牌「${t.name}」？`, body: "吊销后用它的脚本或 Agent 立即无法访问。", confirmLabel: "吊销", tone: "danger" }))) return;
    await fetch(`/api/me/tokens?id=${t.id}`, { method: "DELETE" });
    toast.success("已吊销");
    void load();
  }

  return (
    <>
      <dl className="nv-skills-kv">
        <div>
          <dt>MCP 地址</dt>
          <dd>
            <code>{origin}/api/mcp</code>（Streamable HTTP）
          </dd>
        </div>
        <div>
          <dt>开放接口</dt>
          <dd>
            <code>{origin}/api/v1</code>
          </dd>
        </div>
        <div>
          <dt>请求头</dt>
          <dd>
            <code>Authorization: Bearer 令牌</code>
          </dd>
        </div>
      </dl>
      <p className="nv-skill-note">
        接自己电脑上的 Agent（Claude Code、Cursor…）建议用{" "}
        <Link href="/settings/agents" className="text-link">
          设置 › 本机 Agent
        </Link>
        ，能生成配置写法并测试连通；这里的令牌给脚本、自建系统等用途。权限和数据范围不会超过你本人。
      </p>
      <section aria-labelledby={`${id}-t`} className="nv-skill-sec">
        <div className="nv-skill-sec-head">
          <h2 id={`${id}-t`}>
            我的令牌 <span className="section-count">{data?.tokens.length ?? ""}</span>
          </h2>
          <button type="button" className="btn-primary nv-head-btn" onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" />
            新建令牌
          </button>
        </div>
        {data && data.tokens.length ? (
          <div className="nv-token-table" role="table" aria-label="我的令牌">
            <div role="row" className="nv-token-row is-head">
              <span role="columnheader">名称</span>
              <span role="columnheader">令牌</span>
              <span role="columnheader">权限</span>
              <span role="columnheader">到期 / 最近使用</span>
              <span role="columnheader">
                <span className="sr-only">操作</span>
              </span>
            </div>
            {data.tokens.map((t) => (
              <div role="row" key={t.id} className="nv-token-row">
                <span role="cell">{t.name}</span>
                <span role="cell">
                  <code>{t.masked}</code>
                </span>
                <span role="cell" title={t.scopes.map((s) => SCOPE_LABEL[s] || s).join("、")}>
                  {scopeSummary(t.scopes)}
                </span>
                <span role="cell" suppressHydrationWarning>
                  {t.expiresAt ? day(t.expiresAt) : "长期"} · {ago(t.lastUsedAt)}
                </span>
                <span role="cell">
                  {t.agentConnectionId ? (
                    <Link href="/settings/agents" className="text-link" title="本机 Agent 的令牌在「本机 Agent」里换或删除">
                      去管理
                    </Link>
                  ) : (
                    <button type="button" className="text-link" onClick={() => void revoke(t)}>
                      吊销
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="nv-skills-empty">{data ? "还没有令牌。" : "加载中…"}</p>
        )}
      </section>

      <Modal open={creating} onClose={() => setCreating(false)} title="新建令牌" busy={busy}>
        <div className="nv-pform">
          <div className="nv-pform-body">
            <label className="nv-pfield" htmlFor={`${id}-n`}>
              <span className="nv-pfield-label">名称</span>
              <input id={`${id}-n`} className="input" value={form.name} maxLength={80} placeholder="例如：数据看板脚本" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <div className="nv-pfield">
              <span className="nv-pfield-label">权限（写权限不能超过你账号本身的权限）</span>
              <div className="nv-agents-perms">
                <label>
                  <input type="checkbox" checked={READ.every((s) => form.scopes.includes(s))} onChange={(e) => setForm({ ...form, scopes: e.target.checked ? Array.from(new Set([...form.scopes, ...READ])) : form.scopes.filter((s) => !READ.includes(s)) })} />
                  读取全部（项目、需求、Bug、发版、产品、文档）
                </label>
                {(data?.scopes || []).filter((s) => !READ.includes(s)).map((s) => (
                  <label key={s}>
                    <input type="checkbox" checked={form.scopes.includes(s)} onChange={(e) => setForm({ ...form, scopes: e.target.checked ? [...form.scopes, s] : form.scopes.filter((x) => x !== s) })} />
                    {SCOPE_LABEL[s] || s}
                  </label>
                ))}
              </div>
            </div>
            <label className="nv-pfield" htmlFor={`${id}-d`}>
              <span className="nv-pfield-label">有效期</span>
              <select id={`${id}-d`} className="input" value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}>
                {[30, 90, 180, 365].map((d) => (
                  <option key={d} value={d}>
                    {d} 天
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="nv-pform-foot">
            <span className="nv-pform-note">创建后令牌只显示一次</span>
            <ModalCancelButton className="btn-secondary nv-head-btn" />
            <button type="button" className="btn-primary nv-head-btn" disabled={busy || !form.name.trim() || !form.scopes.length} onClick={() => void create()}>
              创建
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(created)} onClose={() => setCreated(null)} title="令牌已创建">
        {created ? (
          <div className="nv-pform">
            <div className="nv-pform-body">
              <p className="nv-agents-wait">请现在复制保存。关闭后列表里只显示前后几位，完整令牌无法再查看。</p>
              <div className="nv-token-show">
                <code>{created.token}</code>
                <CopyButton text={created.token} />
              </div>
              <p className="nv-pform-intro">
                {created.name} · {scopeSummary(created.scopes)} · {created.days} 天后到期
              </p>
            </div>
            <div className="nv-pform-foot">
              <span className="nv-pform-note" />
              <ModalCancelButton className="btn-primary nv-head-btn">我已复制，完成</ModalCancelButton>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
