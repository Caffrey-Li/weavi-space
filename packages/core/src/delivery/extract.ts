import { inflateRawSync } from "node:zlib";

/**
 * 生成 PRD 时附加的材料：从上传的文件里取纯文本。支持 .txt / .md / .csv / .docx（Word 2007+，自己解 zip，不依赖第三方库）。
 * PDF 和旧版 .doc 暂不支持，提示用户另存为 Word 或复制文字。只在内存里处理，不保存文件。
 */
export class ExtractError extends Error {}

export const MAX_FILES = 3;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TEXT = 30_000;

/** 从 zip 里取一个文件（只支持存储和 deflate 两种压缩方式，足够读 docx） */
export function unzipEntry(zip: Buffer, want: string): Buffer | null {
  // 中央目录结束标记从文件尾往前找（注释最长 64 KB）
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (name !== want) continue;
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) return null;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) return Buffer.from(data);
    if (method === 8) {
      const out = inflateRawSync(data);
      if (out.length > 50 * 1024 * 1024) throw new ExtractError("文件解压后太大");
      return out;
    }
    return null;
  }
  return null;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

/** docx 正文：段落换行、表格单元格用 Tab 隔开，其余标签去掉 */
export function docxText(xml: string) {
  return decode(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractText(name: string, base64: string): string {
  const lower = name.toLowerCase();
  const data = Buffer.from(String(base64 || "").replace(/^data:[^,]+,/, ""), "base64");
  if (!data.length) throw new ExtractError(`「${name}」是空文件`);
  if (data.length > MAX_FILE_BYTES) throw new ExtractError(`「${name}」超过 2 MB`);
  if (/\.(txt|md|markdown|csv)$/.test(lower)) return data.toString("utf8").replace(/^﻿/, "").trim();
  if (lower.endsWith(".docx")) {
    const xml = unzipEntry(data, "word/document.xml");
    if (!xml) throw new ExtractError(`「${name}」不是有效的 Word 文件`);
    return docxText(xml.toString("utf8"));
  }
  if (lower.endsWith(".pdf") || lower.endsWith(".doc")) throw new ExtractError(`「${name}」暂不支持：请另存为 .docx，或把文字复制到补充说明里`);
  throw new ExtractError(`「${name}」格式不支持，只能是 txt / md / csv / docx`);
}

/** 多个附件合成一段材料：每个文件一节，总长度截断 */
export function attachmentsText(files: unknown): { text: string; names: string[] } {
  const list = Array.isArray(files) ? files.slice(0, MAX_FILES + 1) : [];
  if (list.length > MAX_FILES) throw new ExtractError(`最多附加 ${MAX_FILES} 个文件`);
  const parts: string[] = [];
  const names: string[] = [];
  for (const f of list) {
    const name = String((f as { name?: unknown })?.name || "附件").slice(0, 120);
    const t = extractText(name, String((f as { data?: unknown })?.data || ""));
    if (!t) continue;
    names.push(name);
    parts.push(`【附件：${name}】\n${t}`);
  }
  const text = parts.join("\n\n");
  return { text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n（附件内容过长，已截断）` : text, names };
}
