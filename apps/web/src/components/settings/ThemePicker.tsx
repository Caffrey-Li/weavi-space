"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";
const KEY = "pm-theme";
const OPTIONS: { key: Theme; label: string; note: string }[] = [
  { key: "light", label: "浅色", note: "默认" },
  { key: "dark", label: "深色", note: "适合暗光环境" },
  { key: "system", label: "跟随系统", note: "随操作系统切换" },
];

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}

/** 设置 · 外观：主题三选一（带缩略预览），写入 localStorage，根布局首帧读取 */
export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(KEY);
      if (v === "dark" || v === "system" || v === "light") setTheme(v);
    } catch {
      /* 无存储时用默认浅色 */
    }
  }, []);

  function choose(t: Theme) {
    setTheme(t);
    applyTheme(t);
    try {
      window.localStorage.setItem(KEY, t);
    } catch {
      /* 只在本次会话生效 */
    }
  }

  return (
    <div className="nv-theme-grid is-b" role="radiogroup" aria-label="界面主题">
      {OPTIONS.map((o) => {
        const on = o.key === theme;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={on} className={`nv-theme-b${on ? " is-active" : ""}`} onClick={() => choose(o.key)}>
            <span className={`nv-theme-frame is-${o.key}`} aria-hidden="true">
              <span className="nv-theme-win">
                <span className="nv-theme-side">
                  <i />
                  <i className="is-accent" />
                  <i />
                  <i />
                </span>
                <span className="nv-theme-main">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              </span>
            </span>
            <span className="nv-theme-radio">
              <span className="nv-radio-dot" aria-hidden="true" />
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

type Style = "weavi" | "classic";
const STYLE_KEY = "pm-style";
const STYLES: { key: Style; label: string }[] = [
  { key: "weavi", label: "小围（暖橙 · 圆润）" },
  { key: "classic", label: "经典（蓝色 · 简洁）" },
];

export function applyStyle(s: Style) {
  document.documentElement.setAttribute("data-style", s);
}

/** 设置 · 外观：界面风格二选一（小围 / 经典），和浅色深色互相独立 */
export function StylePicker() {
  const [style, setStyle] = useState<Style>("weavi");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STYLE_KEY) === "classic") setStyle("classic");
    } catch {
      /* 无存储时用默认小围 */
    }
  }, []);

  function choose(s: Style) {
    setStyle(s);
    applyStyle(s);
    try {
      window.localStorage.setItem(STYLE_KEY, s);
    } catch {
      /* 只在本次会话生效 */
    }
  }

  return (
    <div className="nv-theme-grid is-b is-style" role="radiogroup" aria-label="界面风格">
      {STYLES.map((o) => {
        const on = o.key === style;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={on} className={`nv-theme-b${on ? " is-active" : ""}`} onClick={() => choose(o.key)}>
            <span className={`nv-theme-frame is-style-${o.key}`} aria-hidden="true">
              <span className="nv-theme-win">
                <span className="nv-theme-side">
                  <i />
                  <i className="is-accent" />
                  <i />
                  <i />
                </span>
                <span className="nv-theme-main">
                  <i />
                  <i />
                  <i />
                  <i className="is-btn" />
                </span>
              </span>
            </span>
            <span className="nv-theme-radio">
              <span className="nv-radio-dot" aria-hidden="true" />
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
