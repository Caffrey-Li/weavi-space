"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { TIMEZONES, type SystemSettings } from "@/lib/system-settings-shared";

/** 设置 · 常规（Figma 19）的表单：标志 + 名称、两列字段、更新设置 */
export function GeneralSettingsForm({ initial, appUrl, canEdit }: { initial: SystemSettings; appUrl: string; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function save(patch: Partial<SystemSettings>, okText: string) {
    setSaving(true);
    setError("");
    const res = await fetch("/api/system/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setSaving(false);
    if (!res?.ok) {
      const msg = (data as { error?: string }).error || "保存失败，请重试";
      setError(msg);
      toast.error(msg);
      return false;
    }
    toast.success(okText);
    router.refresh();
    return true;
  }

  function pickLogo(f: File | undefined) {
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(f.type)) return toast.error("标志只支持 PNG、JPG、WebP 或 SVG");
    if (f.size > 200 * 1024) return toast.error("标志图片不能超过 200KB");
    const reader = new FileReader();
    reader.onload = async () => {
      const logo = String(reader.result || "");
      if (await save({ logo }, "已更新系统标志")) setForm((v) => ({ ...v, logo }));
    };
    reader.readAsDataURL(f);
  }

  const letter = (form.name || "N").slice(0, 1).toUpperCase();

  return (
    <div className="nv-set">
      <div className="nv-sys-head">
        <span className="nv-sys-logo" aria-hidden="true">
          {form.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.logo} alt="" />
          ) : (
            letter
          )}
        </span>
        <span className="nv-sys-head-text">
          <b>{form.name || "未命名系统"}</b>
          <span>{appUrl || "—"}</span>
          {canEdit ? (
            <span className="nv-sys-logo-acts">
              <button type="button" className="nv-sys-link" disabled={saving} onClick={() => file.current?.click()}>
                上传标志
              </button>
              {form.logo ? (
                <button
                  type="button"
                  className="nv-sys-link is-muted"
                  disabled={saving}
                  onClick={async () => {
                    if (await save({ logo: "" }, "已恢复默认标志")) setForm((v) => ({ ...v, logo: "" }));
                  }}
                >
                  恢复默认
                </button>
              ) : null}
              <input
                ref={file}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                hidden
                onChange={(e) => {
                  pickLogo(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </span>
          ) : null}
        </span>
      </div>

      <form
        className="nv-sys-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim()) return setError("请填写系统名称");
          // 规范 5.2：提交按钮不提前禁用，没改动时点了给提示
          if (!dirty) return toast.success("没有需要保存的修改");
          void save({ name: form.name.trim(), timezone: form.timezone, weekStart: form.weekStart }, "已更新设置");
        }}
      >
        {error ? (
          <div role="alert" className="banner-error">
            {error}
          </div>
        ) : null}
        <div className="nv-set-grid nv-sys-grid">
          <label className="nv-pfield" htmlFor={`${id}-name`}>
            <span className="nv-pfield-label">
              系统名称<em aria-hidden="true">*</em>
            </span>
            <input
              id={`${id}-name`}
              className="input"
              value={form.name}
              maxLength={30}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <span className="nv-pfield-hint">显示在左上角和浏览器标签页</span>
          </label>
          <label className="nv-pfield" htmlFor={`${id}-url`}>
            <span className="nv-pfield-label">访问地址</span>
            <input id={`${id}-url`} className="input" value={appUrl} readOnly disabled />
            <span className="nv-pfield-hint">部署时配置（环境变量 APP_URL），这里只读</span>
          </label>
          <label className="nv-pfield" htmlFor={`${id}-tz`}>
            <span className="nv-pfield-label">默认时区</span>
            <select id={`${id}-tz`} className="input" value={form.timezone} disabled={!canEdit} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
              {TIMEZONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="nv-pfield" htmlFor={`${id}-week`}>
            <span className="nv-pfield-label">每周起始日</span>
            <select
              id={`${id}-week`}
              className="input"
              value={form.weekStart}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, weekStart: e.target.value === "0" ? "0" : "1" })}
            >
              <option value="1">周一</option>
              <option value="0">周日</option>
            </select>
            <span className="nv-pfield-hint">影响日期选择器和「本周」统计口径</span>
          </label>
        </div>
        {canEdit ? (
          <div>
            <button type="submit" className="btn-primary nv-head-btn" disabled={saving} aria-busy={saving || undefined}>
              {saving ? "保存中…" : "更新设置"}
            </button>
          </div>
        ) : (
          <p className="nv-pfield-hint">只有系统管理员可以修改系统设置。</p>
        )}
      </form>
    </div>
  );
}
