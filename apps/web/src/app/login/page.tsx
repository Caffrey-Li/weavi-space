"use client";

import { useEffect, useId, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, Eye, EyeOff, Hexagon, MessageCircle, Send } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { safeRedirectPath } from "@/lib/safe-path";
import { LoginStage } from "@/components/auth/LoginStage";
import { InviteLoginPanel } from "@/components/auth/InviteLoginPanel";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const from = safeRedirectPath(search.get("from"));
  const baseId = useId();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const feishuError = search.get("feishu_error") || search.get("sso_error");
  const [feishuMsg, setFeishuMsg] = useState(
    // 只显示固定文案：地址栏里的文字任何人都能拼，不能原样展示在登录页上
    feishuError ? FEISHU_ERRORS[feishuError] || FEISHU_ERRORS.server : search.get("expired") === "1" ? "体验账号已到期，已自动退出。如需继续体验，请联系管理员延长有效期或重新申请。" : "",
  );
  const [feishuBusy, setFeishuBusy] = useState(false);
  // 企业专属登录链接 /login?org=<企业编码>：按企业显示可用的登录方式
  const org = (search.get("org") || "").slice(0, 40);
  const [opts, setOpts] = useState<LoginOptions | null>(null);
  // 邀请 / 重置 / 体验链接都指向 /login?invite=<令牌>，打开时直接进入「邀请登录」
  const invite = (search.get("invite") || "").slice(0, 200);
  const [mode, setMode] = useState<"password" | "code" | "invite">(invite ? "invite" : "password");
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [codeMsg, setCodeMsg] = useState("");
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch(`/api/auth/login-options${org ? `?org=${encodeURIComponent(org)}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: LoginOptions) => {
        if (!alive) return;
        setOpts(d);
        if (!d.email && d.sms) setChannel("sms");
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [org]);
  // 还没有任何系统管理员（全新安装）：去首次安装向导
  useEffect(() => {
    fetch("/api/setup", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { needsSetup?: boolean }) => {
        if (d.needsSetup) router.replace("/setup");
      })
      .catch(() => undefined);
  }, [router]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  const codeEnabled = Boolean(opts?.email || opts?.sms);

  async function sendCode() {
    if (!target.trim() || cooldown > 0) return;
    setError("");
    setCodeMsg("");
    const res = await fetch("/api/auth/code/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org, channel, target }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "发送失败");
      return;
    }
    setCodeMsg(data.message || "验证码已发送");
    setCooldown(60);
  }

  async function onCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/code/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org, channel, target, code, remember }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "登录失败");
        setLoading(false);
        return;
      }
      router.replace(data.mustChangePassword ? "/settings?force=1" : from);
      router.refresh();
    } catch {
      setError("网络异常，请重试");
      setLoading(false);
    }
  }

  async function onGuest() {
    if (loading) return;
    setError("");
    setLoading(true);
    const res = await fetch("/api/auth/guest", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "暂时无法进入体验");
      setLoading(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  function onSso(kind: string) {
    setFeishuBusy(true);
    // 系统级飞书沿用原来的回调地址；企业用自己的应用
    if (kind === "feishu" && !opts?.enterprise) {
      window.location.href = `/api/auth/feishu?from=${encodeURIComponent(from)}`;
      return;
    }
    const q = new URLSearchParams({ from, ...(org ? { org } : {}) });
    window.location.href = `/api/auth/sso/${kind}?${q}`;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, password, remember }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "登录失败");
        setLoading(false);
        return;
      }
      if (data.user?.mustChangePassword) {
        router.replace("/settings?force=1");
      } else {
        router.replace(from);
      }
      router.refresh();
    } catch {
      setError("网络异常，请重试");
      setLoading(false);
    }
  }

  return (
    <div className="nv-login wv-login">
      {/* 小围空间登录页（T19，按 Miora 稿）：左侧主视觉 + 品牌文案，右侧奶油底上的白色登录卡片 */}
      <LoginStage />

      <main className="wv-login-side">
        <span className="wv-login-blob is-1" aria-hidden="true" />
        <span className="wv-login-blob is-2" aria-hidden="true" />
        <div className="wv-login-card">
          <h1 className="wv-login-title">{opts?.enterprise ? `登录 ${opts.enterprise.name}` : "欢迎回来"}</h1>
          <p className="wv-login-sub">{opts?.enterprise ? "使用企业成员账号登录小围空间" : "登录小围空间，继续推进项目"}</p>
          {opts?.unknownOrg ? (
            <p role="status" className="banner-warning mt-3 text-xs">
              登录链接里的企业编码不存在，请向管理员确认专属登录链接。
            </p>
          ) : null}
          <div className="wv-login-seg" role="group" aria-label="登录方式">
            <button type="button" aria-pressed={mode === "password"} onClick={() => setMode("password")}>
              密码登录
            </button>
            <button type="button" aria-pressed={mode === "code"} onClick={() => setMode("code")}>
              验证码登录
            </button>
            <button type="button" aria-pressed={mode === "invite"} onClick={() => setMode("invite")}>
              邀请登录
            </button>
          </div>

          {mode === "invite" ? (
            <InviteLoginPanel initial={invite} />
          ) : mode === "code" && !codeEnabled ? (
            <div className="wv-login-fields">
              <p role="status" className="wv-login-off">
                验证码登录还没有开通。管理员可以在「设置 · 登录管理」里开启邮箱或手机号验证码，现在请先用密码登录。
              </p>
              <button type="button" className="btn-primary wv-login-btn w-full" onClick={() => setMode("password")}>
                改用密码登录
              </button>
            </div>
          ) : mode === "code" ? (
            <form onSubmit={onCodeSubmit} className="login-form wv-login-fields" noValidate>
              {error ? (
                <div role="alert" className="banner-error" tabIndex={-1}>
                  {error}
                </div>
              ) : null}
              {opts?.email && opts?.sms ? (
                <div className="flex gap-4 text-sm" role="radiogroup" aria-label="接收方式">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name={`${baseId}-ch`} checked={channel === "email"} onChange={() => setChannel("email")} />
                    邮箱
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name={`${baseId}-ch`} checked={channel === "sms"} onChange={() => setChannel("sms")} />
                    手机号
                  </label>
                </div>
              ) : null}
              <Field id={`${baseId}-target`} label={channel === "email" ? "邮箱" : "手机号"} required>
                <input
                  className="input"
                  type={channel === "email" ? "email" : "tel"}
                  inputMode={channel === "email" ? "email" : "tel"}
                  placeholder={channel === "email" ? "请输入邮箱" : "请输入手机号"}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  autoComplete={channel === "email" ? "email" : "tel"}
                  required
                />
              </Field>
              <Field id={`${baseId}-code`} label="验证码" required>
                <div className="flex gap-2">
                  <input className="input flex-1" inputMode="numeric" maxLength={6} placeholder="6 位数字" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" required />
                  <button type="button" className="btn-secondary wv-login-sendcode shrink-0" onClick={sendCode} disabled={!target.trim() || cooldown > 0}>
                    {cooldown > 0 ? `${cooldown} 秒后重发` : "发送验证码"}
                  </button>
                </div>
              </Field>
              {codeMsg ? (
                <p role="status" className="text-xs text-nv-text-secondary">
                  {codeMsg}
                </p>
              ) : null}
              <button type="submit" className="btn-primary wv-login-btn w-full" disabled={loading || code.length < 6} aria-busy={loading || undefined}>
                {loading ? "登录中…" : "登录"}
              </button>
            </form>
          ) : (
            <form onSubmit={onSubmit} className="login-form wv-login-fields" noValidate>
              {error ? (
                <div role="alert" className="banner-error" tabIndex={-1}>
                  {error}
                </div>
              ) : null}

              <div className="field">
                <label className="label" htmlFor={`${baseId}-account`}>
                  邮箱 / 手机号
                </label>
                <input
                  id={`${baseId}-account`}
                  className="input"
                  placeholder="请输入邮箱或手机号"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  autoComplete="username"
                  aria-required
                  required
                />
              </div>

              <div className="field">
                <label className="label" htmlFor={`${baseId}-password`}>
                  密码
                </label>
                <div className="relative">
                  <input
                    id={`${baseId}-password`}
                    className="input pr-12"
                    type={showPwd ? "text" : "password"}
                    placeholder="请输入登录密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    aria-required
                    required
                  />
                  <button
                    type="button"
                    className="wv-login-eye"
                    onClick={() => setShowPwd((v) => !v)}
                    aria-pressed={showPwd}
                    aria-label={showPwd ? "隐藏密码" : "显示密码"}
                  >
                    {showPwd ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <div className="wv-login-row">
                <label className="wv-login-keep">
                  <input type="checkbox" className="sr-only" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span className="wv-login-tick" aria-hidden="true">
                    <Check size={11} strokeWidth={3} />
                  </span>
                  保持登录
                </label>
                <Link href="/forgot-password" className="wv-login-forgot">
                  忘记密码？
                </Link>
              </div>

              <button type="submit" className="btn-primary wv-login-btn w-full" disabled={loading} aria-busy={loading || undefined}>
                {loading ? "登录中…" : "登录"}
              </button>
            </form>
          )}

          {/* 邀请登录时不再显示其他登录方式：成员邀请自带第三方登录绑定，体验链接直接进入 */}
          {mode === "invite" ? null : (
            <>
              <div className="wv-login-or">
                <span />
                或
                <span />
              </div>
              {/* 三种扫码登录固定显示；没开通的点了给提示（是否开通由「登录管理」按企业配置） */}
              <div className="wv-login-sso">
                {SSO_KINDS.map((p) => {
                  const on = Boolean(opts?.sso.some((x) => x.kind === p.kind));
                  return (
                    <button
                      key={p.kind}
                      type="button"
                      onClick={() => (on ? onSso(p.kind) : setFeishuMsg(`${p.label}登录还没有开通，请联系管理员在「登录管理」里配置。`))}
                      className={`wv-login-ssobtn${on ? "" : " is-off"}`}
                      disabled={feishuBusy}
                      aria-busy={feishuBusy || undefined}
                    >
                      <p.Icon size={14} aria-hidden="true" />
                      {p.label}登录
                    </button>
                  );
                })}
              </div>
              {opts?.guestDemo ? (
                <button type="button" className="wv-login-guest" onClick={() => void onGuest()} disabled={loading}>
                  <Eye size={15} aria-hidden="true" />
                  以访客身份体验
                  <span>只读 · 演示数据</span>
                </button>
              ) : null}
            </>
          )}
          {feishuMsg ? (
            <p role="status" className="banner-warning mt-3 text-xs">
              {feishuMsg}
            </p>
          ) : null}
          <p className="wv-login-note">仅限受邀成员 · 遇到问题请联系管理员</p>
        </div>
      </main>
    </div>
  );
}

type LoginOptions = {
  enterprise: { name: string; code: string | null } | null;
  unknownOrg: boolean;
  password: boolean;
  sso: { kind: string; label: string }[];
  email: boolean;
  sms: boolean;
  guestDemo?: boolean;
};

const SSO_KINDS = [
  { kind: "feishu", label: "飞书", Icon: Send },
  { kind: "wecom", label: "企业微信", Icon: MessageCircle },
  { kind: "dingtalk", label: "钉钉", Icon: Hexagon },
];

const FEISHU_ERRORS: Record<string, string> = {
  unconfigured: "这个登录方式还没有开通，请联系管理员在「登录管理」里配置后再试。",
  token: "第三方登录换取令牌失败，请稍后重试或联系管理员检查应用配置。",
  userinfo: "读取第三方账号信息失败，请稍后重试。",
  denied: "你取消了飞书授权，未登录。",
  state: "登录请求已过期，请重新点击「飞书登录」。",
  nocode: "飞书没有返回授权码，请重试。",
  not_member: "该账号还没有开通，请联系企业管理员邀请。",
  inactive: "账号已停用，请联系管理员。",
  conflict: "该第三方账号与本系统账号的绑定有冲突，请联系管理员。",
  tenant: "该飞书账号不属于本企业。",
  rate: "登录尝试过于频繁，请稍后再试。",
  server: "登录失败，请稍后重试。",
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-neutral-500">加载中…</div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
