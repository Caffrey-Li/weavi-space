/** React 19 原生支持布尔型 inert（空字符串反而会被当成 false），让元素不可交互、不可聚焦 */
export function inertProps(on: boolean): { inert?: boolean } {
  return on ? { inert: true } : {};
}
