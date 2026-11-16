import sanitizeHtml from "sanitize-html";

/**
 * SVG 白名单清洗（架构图、系统标志）。只保留绘图元素和属性：
 * script、事件属性、外部引用全部去掉，href 只能指向文档内部的 #id 或内嵌图片。
 * 页面只用 <img> 引用，浏览器本来就不执行；清洗是为了直接打开地址或被下载后也安全。
 */
const TAGS = [
  "svg", "g", "defs", "symbol", "use", "title", "desc", "metadata", "style", "switch",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textPath", "image",
  "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask", "marker", "filter",
  "feBlend", "feColorMatrix", "feComposite", "feFlood", "feGaussianBlur", "feMerge", "feMergeNode", "feOffset", "feDropShadow",
  // draw.io 的文字放在 foreignObject 里
  "foreignObject", "div", "span", "p", "br", "b", "i", "u", "font",
];
const ATTRS = [
  "id", "class", "style", "xmlns", "xmlns:xlink", "version", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy",
  "d", "points", "transform", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
  "opacity", "color", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "alignment-baseline", "letter-spacing", "text-decoration", "dx", "dy", "rotate", "textLength",
  "clip-path", "clip-rule", "mask", "marker-start", "marker-mid", "marker-end", "markerWidth", "markerHeight", "markerUnits", "refX", "refY", "orient", "filter", "visibility", "display", "pointer-events",
  "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod", "patternUnits", "patternContentUnits", "patternTransform", "clipPathUnits", "maskUnits", "maskContentUnits",
  "preserveAspectRatio", "stdDeviation", "in", "in2", "result", "mode", "type", "values", "operator", "k1", "k2", "k3", "k4", "flood-color", "flood-opacity", "href", "xlink:href", "face", "size",
];

const safeRef = (v: string) => v.startsWith("#") || /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(v);
/** 样式或属性里的外部地址（CSS 里的 url() 不在白名单检查范围内） */
const EXTERNAL = /@import|url\(\s*["']?\s*(?!#)/i;

/** 清洗 SVG 文本；不是 SVG 或含外部引用时返回 null */
export function sanitizeSvg(input: string): string | null {
  const out = sanitizeHtml(input, {
    allowedTags: TAGS,
    allowedAttributes: { "*": ATTRS },
    allowVulnerableTags: true, // <style>：内容下面单独检查
    allowedSchemes: [],
    allowedSchemesAppliedToAttributes: [],
    parseStyleAttributes: false,
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "textarea", "option", "noscript", "iframe", "object", "embed"],
    parser: { xmlMode: true, lowerCaseTags: false, lowerCaseAttributeNames: false, decodeEntities: true },
    transformTags: {
      "*": (tagName, attribs) => {
        const clean = { ...attribs };
        for (const k of ["href", "xlink:href"]) if (clean[k] !== undefined && !safeRef(clean[k])) delete clean[k];
        return { tagName, attribs: clean };
      },
    },
  }).trim();
  if (!/^<svg[\s>]/.test(out) || EXTERNAL.test(out)) return null;
  return out;
}
