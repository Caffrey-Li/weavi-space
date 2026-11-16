/**
 * 项目配图（内置生成）：按项目名 + 随机种子生成抽象 SVG。纯函数、不依赖外部服务，客户端和服务端都能用。
 * 背景图 1600×400（卡片和概览横幅都按 cover 裁切），图标 256×256（叠加项目名首字）。
 */
export const ART_STYLES = [
  { key: "glow", label: "辉光" },
  { key: "aurora", label: "光晕" },
  { key: "geo", label: "几何" },
  { key: "waves", label: "波纹" },
  { key: "dots", label: "点阵" },
] as const;
export type ArtStyle = (typeof ART_STYLES)[number]["key"];

const PALETTES = [
  ["#0B3B8C", "#2563EB", "#60A5FA", "#93C5FD", "#DBEAFE"],
  ["#064E4B", "#0D9488", "#2DD4BF", "#99F6E4", "#CCFBF1"],
  ["#3B0764", "#7C3AED", "#A78BFA", "#DDD6FE", "#F5F3FF"],
  ["#7C2D12", "#EA580C", "#FB923C", "#FED7AA", "#FFF7ED"],
  ["#14532D", "#16A34A", "#4ADE80", "#BBF7D0", "#F0FDF4"],
  ["#831843", "#DB2777", "#F472B6", "#FBCFE8", "#FDF2F8"],
  ["#0F172A", "#334155", "#64748B", "#CBD5E1", "#F1F5F9"],
  ["#78350F", "#D97706", "#FBBF24", "#FDE68A", "#FFFBEB"],
];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f = (n: number) => Math.round(n * 10) / 10;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 默认风格：辉光（深色底 + 左上角柔和的彩色光，参考控制台指标卡）；不指定风格时都用它 */
export const DEFAULT_ART_STYLE: ArtStyle = "glow";

export function pickArt(name: string, seed = 0, style?: string) {
  const h = hash(`${name}#${seed}`);
  const palette = PALETTES[h % PALETTES.length];
  const st = (ART_STYLES.find((s) => s.key === style)?.key || DEFAULT_ART_STYLE) as ArtStyle;
  return { palette, style: st, rand: rng(h) };
}

function body(w: number, h: number, style: ArtStyle, pal: string[], r: () => number, id: string) {
  let p = pal;
  const s = Math.min(w, h) / 400; // 以 400 高为基准缩放图形
  const defs: string[] = [];
  const parts: string[] = [];
  if (style === "glow") {
    // 石墨色在深色底上看不出光，换成蓝色
    if (p[1] === "#334155") p = PALETTES[0];
    // 深色玻璃底 + 一团主色辉光（位置随种子在左上到中上之间），右下一点点副色，顶部一条细高光
    const cx = 0.1 + r() * 0.35;
    const glowR = 0.38 + r() * 0.15;
    defs.push(`<linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22232B"/><stop offset="1" stop-color="#17171C"/></linearGradient>`);
    defs.push(`<radialGradient id="${id}g" cx="${f(cx * w)}" cy="${f(-0.1 * h)}" r="${f(glowR * Math.max(w, h * 2.2))}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${p[1]}" stop-opacity="0.85"/><stop offset="0.4" stop-color="${p[1]}" stop-opacity="0.3"/><stop offset="1" stop-color="${p[1]}" stop-opacity="0"/></radialGradient>`);
    defs.push(`<radialGradient id="${id}s" cx="${f((0.75 + r() * 0.2) * w)}" cy="${f(1.1 * h)}" r="${f(0.45 * Math.max(w, h * 2.2))}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${p[2]}" stop-opacity="0.16"/><stop offset="1" stop-color="${p[2]}" stop-opacity="0"/></radialGradient>`);
    defs.push(`<linearGradient id="${id}h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="${f(cx)}" stop-color="#FFFFFF" stop-opacity="0.18"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>`);
    parts.push(`<rect width="${w}" height="${h}" fill="url(#${id}b)"/>`);
    parts.push(`<rect width="${w}" height="${h}" fill="url(#${id}g)"/>`);
    parts.push(`<rect width="${w}" height="${h}" fill="url(#${id}s)"/>`);
    parts.push(`<rect width="${w}" height="${f(Math.max(1, 1.5 * s))}" fill="url(#${id}h)"/>`);
  } else if (style === "aurora") {
    defs.push(`<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p[0]}"/><stop offset="1" stop-color="${p[1]}"/></linearGradient>`);
    defs.push(`<filter id="${id}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${f(60 * s)}"/></filter>`);
    parts.push(`<rect width="${w}" height="${h}" fill="url(#${id}g)"/>`);
    const blobs: string[] = [];
    for (let i = 0; i < 6; i++) {
      blobs.push(`<circle cx="${f(r() * w)}" cy="${f(r() * h)}" r="${f((90 + r() * 160) * s)}" fill="${p[2 + (i % 3)]}" opacity="${f(0.35 + r() * 0.45)}"/>`);
    }
    parts.push(`<g filter="url(#${id}b)">${blobs.join("")}</g>`);
  } else if (style === "geo") {
    defs.push(`<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${p[1]}"/><stop offset="1" stop-color="${p[0]}"/></linearGradient>`);
    parts.push(`<rect width="${w}" height="${h}" fill="url(#${id}g)"/>`);
    const n = Math.round((w * h) / (50000 * s * s)) + 8;
    for (let i = 0; i < n; i++) {
      const x = r() * w;
      const y = r() * h;
      const z = (30 + r() * 110) * s;
      const c = [p[2], p[3], p[4], "#FFFFFF"][Math.floor(r() * 4)];
      const o = f(0.12 + r() * 0.3);
      const k = r();
      if (k < 0.34) parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(z / 2)}" fill="${c}" opacity="${o}"/>`);
      else if (k < 0.67) parts.push(`<rect x="${f(x - z / 2)}" y="${f(y - z / 2)}" width="${f(z)}" height="${f(z)}" rx="${f(z * 0.12)}" fill="${c}" opacity="${o}" transform="rotate(${f(r() * 90)} ${f(x)} ${f(y)})"/>`);
      else parts.push(`<path d="M${f(x)} ${f(y - z / 2)}L${f(x + z / 2)} ${f(y + z / 2)}L${f(x - z / 2)} ${f(y + z / 2)}Z" fill="${c}" opacity="${o}" transform="rotate(${f(r() * 120)} ${f(x)} ${f(y)})"/>`);
    }
  } else if (style === "waves") {
    defs.push(`<linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p[4]}"/><stop offset="1" stop-color="${p[3]}"/></linearGradient>`);
    parts.push(`<rect width="${w}" height="${h}" fill="url(#${id}g)"/>`);
    for (let i = 0; i < 5; i++) {
      const base = h * (0.35 + i * 0.14);
      const amp = (14 + r() * 26) * s;
      const len = w / (1 + r() * 1.6);
      const ph = r() * Math.PI * 2;
      let d = `M0 ${f(base)}`;
      for (let x = 0; x <= w; x += w / 40) d += `L${f(x)} ${f(base + Math.sin((x / len) * Math.PI * 2 + ph) * amp)}`;
      d += `L${w} ${h}L0 ${h}Z`;
      parts.push(`<path d="${d}" fill="${p[Math.max(0, 3 - i)]}" opacity="${f(0.55 + i * 0.1)}"/>`);
    }
  } else {
    defs.push(`<linearGradient id="${id}g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${p[0]}"/><stop offset="1" stop-color="${p[1]}"/></linearGradient>`);
    parts.push(`<rect width="${w}" height="${h}" fill="url(#${id}g)"/>`);
    const gap = 30 * s;
    const ax = r() * 6;
    const ay = r() * 6;
    const fx = 0.6 + r() * 1.4;
    const fy = 0.6 + r() * 1.4;
    for (let y = gap / 2; y < h; y += gap) {
      for (let x = gap / 2; x < w; x += gap) {
        const v = (Math.sin((x / w) * fx * Math.PI * 2 + ax) + Math.cos((y / h) * fy * Math.PI * 2 + ay)) / 4 + 0.5;
        const rad = f(1 + v * 7 * s);
        if (rad > 1.4) parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${rad}" fill="${v > 0.6 ? "#FFFFFF" : p[3]}" opacity="${f(0.2 + v * 0.5)}"/>`);
      }
    }
  }
  return { defs: defs.join(""), parts: parts.join("") };
}

export function coverSvg(name: string, seed = 0, style?: string) {
  const { palette, style: st, rand } = pickArt(name, seed, style);
  const w = 1600;
  const h = 400;
  const b = body(w, h, st, palette, rand, "c");
  return { style: st, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice"><defs>${b.defs}</defs>${b.parts}</svg>` };
}

export function iconSvg(name: string, seed = 0, style?: string) {
  const { palette, style: st, rand } = pickArt(name, seed, style);
  const w = 256;
  const b = body(w, w, st, palette, rand, "i");
  const ch = esc(Array.from((name || "项").trim())[0] || "项").toUpperCase();
  const light = st === "waves";
  // 辉光图标：字用主色的浅色，像截图里描边图标的发光效果
  const glyph = st === "glow" ? palette[3] : light ? palette[0] : "#FFFFFF";
  const text = `<text x="128" y="128" dy="0.35em" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, Noto Sans SC, Helvetica, Arial, sans-serif" font-size="128" font-weight="600" fill="${glyph}" opacity="0.95">${ch}</text>`;
  return { style: st, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}" viewBox="0 0 ${w} ${w}"><defs>${b.defs}</defs>${b.parts}${text}</svg>` };
}
