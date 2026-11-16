/** 项目的稳定代表色（图标底色、标签圆点、卡片封面共用），服务端和客户端都可调用 */
export const ICON_TONES = [
  "var(--nv-blue-600)",
  "var(--nv-green-600)",
  "var(--nv-amber-600)",
  "var(--nv-purple-600)",
  "var(--nv-teal-600)",
  "var(--nv-pink-600)",
  "var(--nv-indigo-600)",
];

export function projectTone(name: string) {
  return ICON_TONES[(name?.charCodeAt(0) || 0) % ICON_TONES.length];
}
