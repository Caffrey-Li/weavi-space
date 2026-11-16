"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/** 密码输入框：右侧眼睛按钮切换明文（Plane 稿）。id / aria-* 由 Field 注入。 */
export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <span className="password-field">
      <input {...props} type={show ? "text" : "password"} className="input password-input" />
      <button
        type="button"
        className="password-toggle"
        aria-label={show ? "隐藏密码" : "显示密码"}
        aria-pressed={show}
        onClick={() => setShow((v) => !v)}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </span>
  );
}
