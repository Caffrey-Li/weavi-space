import { StylePicker, ThemePicker } from "@/components/settings/ThemePicker";
import { WorkHeader } from "@/components/layout/WorkHeader";

/** 设置 · 外观（Figma 18） */
export default function AppearancePage() {
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "外观", icon: "sun" }]} />
      <div className="nv-page-body">
        <div className="nv-set nv-appearance">
          <header className="nv-set-title">
            <h1>外观</h1>
            <p>只影响你自己的显示效果，不会改变其他成员。</p>
          </header>
          <section className="nv-set-section" aria-labelledby="theme-title">
            <header>
              <h2 id="theme-title">主题</h2>
              <p>跟随系统时，会随 macOS / Windows 的浅色、深色自动切换。</p>
            </header>
            <ThemePicker />
          </section>
          <section className="nv-set-section" aria-labelledby="style-title">
            <header>
              <h2 id="style-title">界面风格</h2>
              <p>小围是新版的暖橙圆润风格，经典是原来的蓝色风格。两种风格都支持浅色和深色。</p>
            </header>
            <StylePicker />
          </section>
        </div>
      </div>
    </div>
  );
}
