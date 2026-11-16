/**
 * AI 对话「本地文件夹」工作区：在浏览器里读用户选的文件夹（<input webkitdirectory>），
 * 只取文本文件、跳过依赖和构建目录，按「说明文档优先、小文件优先」截到总字数上限。
 * 读到的内容只在提问时随请求发给所选模型，服务端不保存。纯函数部分可在测试里直接用。
 */
export type LocalFolder = { name: string; tree: string[]; files: { path: string; content: string }[]; total: number; skipped: number };

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".next-dev", "dist", "build", "out", "coverage", ".turbo", ".venv", "venv", "__pycache__", ".idea", ".vscode", "target", "vendor", ".DS_Store"]);
const TEXT_EXT = new Set([
  "md", "mdx", "txt", "rst", "adoc", "csv", "tsv", "json", "jsonc", "yaml", "yml", "toml", "ini", "env.example", "xml", "html", "htm", "css", "scss", "less",
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "vue", "svelte", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cc", "cpp", "hpp", "cs", "php", "sh", "zsh", "bash", "sql", "prisma", "graphql", "proto", "gradle", "properties",
]);
export const LOCAL_FILE_MAX = 200 * 1024; // 单个文件超过 200 KB 不读内容
export const LOCAL_TOTAL_CHARS = 80_000; // 和服务端上限一致
export const LOCAL_TREE_MAX = 600;

export function isReadable(path: string, size: number) {
  const segs = path.split("/");
  if (segs.some((s) => SKIP_DIRS.has(s))) return false;
  const base = segs[segs.length - 1].toLowerCase();
  if (base.startsWith(".env") && base !== ".env.example") return false; // 不读密钥文件
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : base;
  return size <= LOCAL_FILE_MAX && (TEXT_EXT.has(ext) || base === "readme" || base === "dockerfile" || base === "makefile");
}

/** 说明文档在前（README、docs、*.md），其次按大小从小到大 */
export function priority(path: string, size: number) {
  const p = path.toLowerCase();
  const doc = /(^|\/)readme/.test(p) ? 0 : /(^|\/)docs?\//.test(p) || p.endsWith(".md") ? 1 : 2;
  return doc * 1e9 + size;
}

export async function readLocalFolder(list: FileList | File[]): Promise<LocalFolder | null> {
  const all = Array.from(list).map((f) => ({ f, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name }));
  if (!all.length) return null;
  const name = all[0].path.split("/")[0] || "本地文件夹";
  const visible = all.filter((x) => !x.path.split("/").some((s) => SKIP_DIRS.has(s)));
  const tree = visible.map((x) => x.path.split("/").slice(1).join("/") || x.path).slice(0, LOCAL_TREE_MAX);
  const readable = visible.filter((x) => isReadable(x.path, x.f.size)).sort((a, b) => priority(a.path, a.f.size) - priority(b.path, b.f.size));
  const files: LocalFolder["files"] = [];
  let budget = LOCAL_TOTAL_CHARS;
  for (const x of readable) {
    if (budget <= 0) break;
    const text = await x.f.text();
    if (text.includes("\u0000")) continue; // 二进制
    const content = text.slice(0, budget);
    budget -= content.length;
    files.push({ path: x.path.split("/").slice(1).join("/") || x.path, content });
  }
  return { name, tree, files, total: visible.length, skipped: all.length - files.length };
}
