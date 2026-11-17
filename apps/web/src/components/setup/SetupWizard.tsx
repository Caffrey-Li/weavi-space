"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { LoginStage } from "@/components/auth/LoginStage";

type Step = "code" | "admin" | "basics" | "done";
const STEPS: { key: Step; label: string }[] = [
  { key: "code", label: "安装码" },
  { key: "admin", label: "管理员" },
  { key: "basics", label: "系统与企业" },
  { key: "done", label: "完成" },
];
const NEXT_TODO = [
  { label: "邀请成员", where: "组织 · 成员管理", href: "/members" },
  { label: "配置邮箱发信（邀请、验证码）", where: "设置 · 登录管理", href: "/system/login" },
  { label: "配置 AI 模型", where: "设置 · 模型管理", href: "/settings/models" },
  { label: "加一个备用超管", where: "设置 · 系统超管", href: "/system/admins" },
  { label: "给同事发体验链接（演示组织）", where: "设置 · 演示体验", href: "/system/demo" },
];

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(d.error || "操作失败，请重试");
  return d;
}

/** 首次安装向导（Figma 84～87）：安装码 → 创建超级管理员 → 系统名称与第一个企业 → 完成 */
export function SetupWizard({ initialStep, defaultSystemName }: { initialStep: Step; defaultSystemName: string }) {
  const id = useId();
  const [step, setStep] = useState<Step>(initialStep);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [systemName, setSystemName] = useState(defaultSystemName);
  const [entName, setEntName] = useState("");
  const [entCode, setEntCode] = useState("");
  const [demo, setDemo] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = STEPS.findIndex((s) => s.key === step);

  async function run(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const onCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await post("/api/setup/verify", { code });
      setStep("admin");
    });
  };
  const onAdmin = (e: FormEvent) => {
    e.preventDefault();
    if (pwd !== pwd2) return setError("两次输入的密码不一样");
    void run(async () => {
      await post("/api/setup/admin", { code, name, email, password: pwd });
      // 已经登录，换到带会话的第 3 步（服务端按超管身份放行）
      window.location.replace("/setup?step=basics");
    });
  };
  const onBasics = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await post("/api/setup/basics", { systemName: systemName.trim() === defaultSystemName ? "" : systemName, enterpriseName: entName, enterpriseCode: entCode, demo });
      setStep("done");
    });
  };

  const titles: Record<Step, [string, string]> = {
    code: ["开始安装小围空间", "这台服务器还没有管理员，先输入启动日志里的安装码。"],
    admin: ["创建超级管理员", "这个账号能管理整个系统，请牢记密码。"],
    basics: ["系统和企业", "可以先跳过，以后在「设置」里改。"],
    done: ["安装完成", "系统已经可以使用，接下来建议做这几件事："],
  };

  return (
    <div className="nv-login wv-login">
      <LoginStage />
      <main className="wv-login-side">
        <span className="wv-login-blob is-1" aria-hidden="true" />
        <span className="wv-login-blob is-2" aria-hidden="true" />
        <div className="wv-login-card">
          <h1 className="wv-login-title">{titles[step][0]}</h1>
          <p className="wv-login-sub">{titles[step][1]}</p>
          <ol className="wv-login-seg wv-setup-steps" aria-label="安装步骤">
            {STEPS.map((s, i) => (
              <li key={s.key} aria-current={i === current ? "step" : undefined} data-done={i < current || undefined}>
                {i + 1} {s.label}
              </li>
            ))}
          </ol>

          {error ? (
            <div role="alert" className="banner-error mt-5">
              {error}
            </div>
          ) : null}

          {step === "code" ? (
            <form onSubmit={onCode} className="wv-login-fields" noValidate>
              <Field id={`${id}-code`} label="安装码" required>
                <input className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 12))} placeholder="8 位安装码，例如 K7Q2-9MXA" autoComplete="off" spellCheck={false} required autoFocus />
              </Field>
              <p className="wv-setup-hint">
                在服务器上执行 <code>journalctl -u weavi-space | grep 安装码</code> 查看（Docker 部署看 <code>docker compose logs web</code>）。
              </p>
              <button type="submit" className="btn-primary wv-login-btn w-full" disabled={busy || code.replace(/[^0-9A-Za-z]/g, "").length < 8} aria-busy={busy || undefined}>
                {busy ? "核对中…" : "下一步"}
              </button>
              <p className="wv-login-note">安装码 24 小时内有效，服务重启后会重新生成</p>
            </form>
          ) : step === "admin" ? (
            <form onSubmit={onAdmin} className="wv-login-fields" noValidate>
              <Field id={`${id}-name`} label="姓名" required>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 王小围" maxLength={40} autoComplete="name" required autoFocus />
              </Field>
              <Field id={`${id}-email`} label="登录邮箱" required>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="email" required />
              </Field>
              <div className="field">
                <label className="label" htmlFor={`${id}-pwd`}>
                  密码
                  <span aria-hidden="true"> *</span>
                  <span className="sr-only">（必填）</span>
                </label>
                <div className="relative">
                  <input id={`${id}-pwd`} className="input pr-12" type={showPwd ? "text" : "password"} value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="至少 10 位，包含字母和数字" autoComplete="new-password" aria-required required />
                  <button type="button" className="wv-login-eye" onClick={() => setShowPwd((v) => !v)} aria-pressed={showPwd} aria-label={showPwd ? "隐藏密码" : "显示密码"}>
                    {showPwd ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </div>
              </div>
              <Field id={`${id}-pwd2`} label="确认密码" required>
                <input className="input" type={showPwd ? "text" : "password"} value={pwd2} onChange={(e) => setPwd2(e.target.value)} placeholder="再输入一次" autoComplete="new-password" required />
              </Field>
              <p className="wv-setup-hint">密码只保存加密结果，忘记后可在服务器执行 <code>npm run reset-admin -- 邮箱</code> 重置。</p>
              <button type="submit" className="btn-primary wv-login-btn w-full" disabled={busy || !name.trim() || !email.trim() || !pwd || !pwd2} aria-busy={busy || undefined}>
                {busy ? "创建中…" : "创建并登录"}
              </button>
              <p className="wv-login-note">创建后安装码立即作废</p>
            </form>
          ) : step === "basics" ? (
            <form onSubmit={onBasics} className="wv-login-fields" noValidate>
              <Field id={`${id}-sys`} label="系统名称">
                <input className="input" value={systemName} onChange={(e) => setSystemName(e.target.value)} placeholder="小围空间" maxLength={30} />
              </Field>
              <Field id={`${id}-ent`} label="企业名称">
                <input className="input" value={entName} onChange={(e) => setEntName(e.target.value)} placeholder="例如 星河科技" maxLength={50} />
              </Field>
              <Field id={`${id}-entcode`} label="企业编码" hint={entCode ? `专属登录链接 /login?org=${entCode}` : "字母、数字或短横线，用在专属登录链接里"}>
                <input className="input" value={entCode} onChange={(e) => setEntCode(e.target.value.toLowerCase())} placeholder="例如 xinghe" maxLength={32} spellCheck={false} />
              </Field>
              <p className="wv-setup-hint">企业用来隔离数据：成员、项目和产品都属于某个企业。</p>
              <label className="wv-setup-check">
                <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
                <span>
                  <b>同时生成演示组织</b>
                  <small>独立企业「示例科技」和全套演示数据，可在 设置 › 演示体验 里重置或删除。</small>
                </span>
              </label>
              <button type="submit" className="btn-primary wv-login-btn w-full" disabled={busy || (Boolean(entName.trim()) !== Boolean(entCode.trim()))} aria-busy={busy || undefined}>
                {busy ? (demo ? "保存并生成演示数据…" : "保存中…") : "保存，下一步"}
              </button>
              <button type="button" className="wv-setup-skip" onClick={() => setStep("done")}>
                跳过，以后再设
              </button>
            </form>
          ) : (
            <div className="wv-login-fields">
              <ul className="wv-setup-todo">
                {NEXT_TODO.map((t) => (
                  <li key={t.href}>
                    <Link href={t.href}>
                      <span>{t.label}</span>
                      <span className="wv-setup-where">
                        {t.where}
                        <ArrowRight size={13} aria-hidden="true" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href="/" className="btn-primary wv-login-btn w-full">
                进入工作台
              </Link>
              <p className="wv-login-note">安装向导已关闭，之后访问 /setup 会显示 404</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
