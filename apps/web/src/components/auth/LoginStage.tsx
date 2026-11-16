"use client";

import { useId } from "react";

/** 登录页、首次安装向导共用的左侧主视觉和品牌文案（T19，按 Miora 稿） */
export function LoginStage() {
  return (
    <section className="wv-login-stage" aria-label="小围空间">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/login-hero.jpg" alt="" aria-hidden="true" className="wv-login-art" />
      <div className="wv-login-veil" aria-hidden="true" />
      <div className="wv-login-copy">
        <div className="wv-login-lockup">
          <LockupMark />
          <span className="wv-login-name">
            <b>小围空间</b>
            <span>Weavi Space</span>
          </span>
        </div>
        <div className="wv-login-headline">
          <h2>
            把人、事和 AI，
            <br />
            织在一起
          </h2>
          <p>
            需求、看板、发版、文档和 AI 助手，
            <br />
            在一个温暖的小空间里协同。
          </p>
          <ul className="wv-login-tags">
            <li>需求到上线一步步闭环</li>
            <li>AI 助手小围随叫随到</li>
            <li>企业数据安全隔离</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/** 登录页左上角的品牌圆环（按 Miora 稿的矢量标）；viewBox 以圆环为中心裁切，和右侧文字垂直居中对齐，右上角的星光允许溢出 */
function LockupMark() {
  const gid = useId();
  return (
    <svg width="30" height="30" viewBox="2 5.5 33 33" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="8" y1="8" x2="32" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF9A5C" />
          <stop offset="0.55" stopColor="#FF7A3D" />
          <stop offset="1" stopColor="#FF5F63" />
        </linearGradient>
      </defs>
      <circle cx="18.5" cy="22" r="11.2" stroke={`url(#${gid})`} strokeWidth="6.4" />
      <path d="M18.5 10.8c2.4 3.9 5.3 6.1 9.4 7.6-4.1 1.5-7 3.7-9.4 7.6-2.4-3.9-5.3-6.1-9.4-7.6 4.1-1.5 7-3.7 9.4-7.6Z" fill="#FFF6EC" opacity=".28" />
      <path d="M31.4 6.2c.5 3.2 1.6 4.4 4.8 5-3.2.6-4.3 1.8-4.8 5-.5-3.2-1.6-4.4-4.8-5 3.2-.6 4.3-1.8 4.8-5Z" fill="#FFD34D" />
    </svg>
  );
}

