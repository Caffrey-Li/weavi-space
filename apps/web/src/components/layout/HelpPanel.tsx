/** 源代码地址（AGPL-3.0 第 13 条：向网络用户提供源代码）；部署修改版时用 NEXT_PUBLIC_SOURCE_CODE_URL 指向自己的仓库 */
const SOURCE_URL = process.env.NEXT_PUBLIC_SOURCE_CODE_URL || "https://github.com/Caffrey-Li/weavi-space";

/** 帮助与快捷键浮层：全局栏右侧「ⓘ」与侧栏底部共用 */
export function HelpPanel({ id, placement = "down" }: { id?: string; placement?: "down" | "up" }) {
  return (
    <div id={id} role="dialog" aria-label="帮助与快捷键" className={`nv-menu nv-help-panel is-${placement}`}>
      <div className="nv-menu-label">快捷键</div>
      <dl className="nv-help-keys">
        <dt>
          <kbd>[</kbd>
        </dt>
        <dd>收起 / 展开侧栏</dd>
        <dt>
          <kbd>Enter</kbd>
        </dt>
        <dd>在全局栏搜索需求标题</dd>
        <dt>
          <kbd>Esc</kbd>
        </dt>
        <dd>关闭弹窗、菜单和抽屉</dd>
      </dl>
      <div className="nv-menu-sep" role="separator" />
      <div className="nv-help-foot">
        小围空间 Weavi Space · v2.0 ·{" "}
        <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="text-link">
          源代码（AGPL-3.0）
        </a>
      </div>
    </div>
  );
}
