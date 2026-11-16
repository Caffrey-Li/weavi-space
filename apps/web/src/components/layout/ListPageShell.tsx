import type { ReactNode } from "react";

/**
 * 列表页（Nova「通栏」布局）：功能区（标题 + 操作）与筛选工具栏固定在顶部，
 * 中间列表独立滚动，分页固定在底部；内容铺满，左右 20。
 */
export function ListPageShell({
  header,
  toolbar,
  children,
  footer,
  className = "",
}: {
  header?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`list-page nv-list-page ${className}`}>
      {header ? <div className="nv-workhead">{header}</div> : null}
      {toolbar ? <div className="nv-toolbar">{toolbar}</div> : null}
      <div className="list-table-scroll nv-list-scroll">{children}</div>
      {footer != null && <div className="nv-list-foot">{footer}</div>}
    </div>
  );
}
