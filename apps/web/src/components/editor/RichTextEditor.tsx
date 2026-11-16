"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Paperclip,
  Quote,
  Strikethrough,
  Table,
  Trash2,
  Underline,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const MAX_WIDTH = 1600;
const MAX_BYTES = 5 * 1024 * 1024;

/** 配图上传前缩到 1600px 宽（GIF 原样），超大截图通常压到几百 KB */
async function shrinkImage(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("图片无法读取"));
      el.src = url;
    });
    const scale = Math.min(1, MAX_WIDTH / img.naturalWidth);
    if (scale === 1 && file.size < 800 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
    return blob && blob.size < file.size ? blob : file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type UploadedAttachment = { id: string; url: string; name: string; mime: string };

export async function uploadAttachment(file: File, kind: "image" | "file", ownerType = "requirement"): Promise<UploadedAttachment> {
  const blob = kind === "image" ? await shrinkImage(file) : file;
  if (blob.size > MAX_BYTES) throw new Error("单个文件不能超过 5MB");
  const fd = new FormData();
  fd.append("file", blob instanceof File ? blob : new File([blob], file.name, { type: blob.type }));
  fd.append("kind", kind);
  fd.append("ownerType", ownerType);
  const res = await fetch("/api/attachments", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || "上传失败");
  return data as UploadedAttachment;
}

function escapeHtml(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type RichTextHandle = {
  focus: () => void;
  clear: () => void;
  getHtml: () => string;
  setHtml: (html: string) => void;
  /** 打开文件选择，上传后插到光标处（没有光标时插到末尾） */
  pickFile: (kind: "image" | "file") => void;
};

type Tool = { key: string; label: string; Icon: LucideIcon; run: () => void; state?: string };

/**
 * 富文本编辑器（需求描述 / 评论共用）：contentEditable + 工具栏。
 * 支持加粗、斜体、下划线、删除线、对齐、有序 / 无序 / 待办列表、引用、代码块、链接（⌘K）、表格、插入图片（也可粘贴、拖入）、附件。
 * Markdown 快捷输入：行首输入「# 」「## 」「- 」「1. 」「> 」「[] 」「``` 」后自动转换。
 * 图片：点击选中后可拖动四角缩放，或用浮动工具条按 25% / 50% / 75% / 100% 调整、删除（宽度存为 img 的 width 属性）。
 * 产出的 HTML 由服务端 sanitizeDocHtml 清洗；图片和附件先上传到 /api/attachments。
 */
export const RichTextEditor = forwardRef<
  RichTextHandle,
  {
    initialHtml?: string;
    placeholder?: string;
    ariaLabel: string;
    /** compact：评论框；full：需求描述 */
    variant?: "full" | "compact";
    toolbar?: "top" | "bottom";
    ownerType?: string;
    autoFocus?: boolean;
    className?: string;
    onChange?: (html: string) => void;
    /** ⌘/Ctrl + Enter */
    onSubmit?: () => void;
    /** 工具栏右侧附加内容（例如评论的「发送」按钮） */
    toolbarEnd?: React.ReactNode;
  }
>(function RichTextEditor(
  { initialHtml = "", placeholder, ariaLabel, variant = "full", toolbar = "top", ownerType, autoFocus, className, onChange, onSubmit, toolbarEnd },
  ref,
) {
  const toast = useToast();
  const editor = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [empty, setEmpty] = useState(!initialHtml);
  // 首屏就渲染初始内容（服务端输出里也有，不再等挂载后写入）。
  // 注意：必须是同一个对象。Next 自带的 React 按对象引用比较 dangerouslySetInnerHTML，
  // 每次渲染传新对象会把编辑区 innerHTML 重置成初始值，用户输入的字会被立刻清掉。
  const [seedHtml] = useState(() => ({ __html: initialHtml }));
  const [uploading, setUploading] = useState(0);
  const [active, setActive] = useState<Record<string, boolean> & { block?: string }>({});
  // 中文等输入法组字期间不触发重渲染（组字中改动编辑区或其属性，Chrome 会打断组字）；组字结束再同步一次
  const composing = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // 链接
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  // 选中的图片 + 叠加层位置
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (editor.current) editor.current.innerHTML = initialHtml;
    setEmpty(!initialHtml);
    if (autoFocus) editor.current?.focus();
    // 只在挂载时写入初始内容；之后由用户编辑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = useCallback(() => {
    const el = editor.current;
    if (!el || composing.current) return;
    const isEmpty = !el.textContent?.trim() && !el.querySelector("img");
    setEmpty(isEmpty);
    onChange?.(isEmpty ? "" : el.innerHTML);
  }, [onChange]);

  useImperativeHandle(ref, () => ({
    focus: () => editor.current?.focus(),
    clear: () => {
      if (editor.current) editor.current.innerHTML = "";
      setEmpty(true);
      onChange?.("");
    },
    getHtml: () => {
      const el = editor.current;
      return el && (el.textContent?.trim() || el.querySelector("img")) ? el.innerHTML : "";
    },
    setHtml: (html: string) => {
      if (editor.current) editor.current.innerHTML = html;
      emit();
    },
    pickFile: (kind) => (kind === "image" ? imageInput : fileInput).current?.click(),
  }));

  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && editor.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
  }
  function restoreSelection() {
    const el = editor.current;
    if (!el) return;
    const sel = window.getSelection();
    // 焦点还在编辑器里（工具栏按钮 mousedown 时阻止了失焦）：直接用当前光标
    if (document.activeElement === el && sel && sel.rangeCount && el.contains(sel.anchorNode)) return;
    el.focus();
    if (!sel) return;
    if (savedRange.current && el.contains(savedRange.current.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    } else if (!el.contains(sel.anchorNode)) {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  // ---------- 图片选中 / 缩放 ----------
  const placeBox = useCallback(() => {
    const wrap = wrapRef.current;
    if (!img || !wrap || !img.isConnected) {
      setBox(null);
      return;
    }
    const w = wrap.getBoundingClientRect();
    const r = img.getBoundingClientRect();
    setBox({ left: r.left - w.left + wrap.scrollLeft, top: r.top - w.top + wrap.scrollTop, width: r.width, height: r.height });
  }, [img]);
  useLayoutEffect(() => {
    placeBox();
  }, [placeBox]);
  useEffect(() => {
    if (!img) return;
    const onScroll = () => placeBox();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t === img || t.closest?.(".rt-img-tools") || t.closest?.(".rt-img-handle")) return;
      setImg(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [img, placeBox]);

  const maxImgWidth = () => {
    const el = editor.current;
    if (!el) return 800;
    const cs = getComputedStyle(el);
    return Math.max(60, el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  };
  function setImgWidth(px: number) {
    if (!img) return;
    const w = Math.round(Math.max(60, Math.min(maxImgWidth(), px)));
    img.setAttribute("width", String(w));
    img.style.removeProperty("width");
    placeBox();
  }
  function startResize(e: React.PointerEvent, corner: "nw" | "ne" | "sw" | "se") {
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = img.getBoundingClientRect().width;
    const dir = corner === "ne" || corner === "se" ? 1 : -1;
    const move = (ev: PointerEvent) => setImgWidth(startW + (ev.clientX - startX) * dir);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      emit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  function deleteImg() {
    if (!img) return;
    const p = img.parentElement;
    img.remove();
    if (p && p !== editor.current && !p.textContent?.trim() && !p.querySelector("img")) p.remove();
    setImg(null);
    emit();
  }

  // ---------- 链接 / 表格 ----------
  function openLink() {
    saveSelection();
    const sel = window.getSelection();
    const a = (sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement)?.closest("a");
    setLinkUrl(a?.getAttribute("href") || "");
    setLinkOpen(true);
  }
  function applyLink(e: React.FormEvent) {
    e.preventDefault();
    let url = linkUrl.trim();
    setLinkOpen(false);
    restoreSelection();
    if (!url) {
      document.execCommand("unlink");
      emit();
      return;
    }
    if (!/^(https?:|mailto:|\/)/i.test(url)) url = `https://${url}`;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) document.execCommand("createLink", false, url);
    else document.execCommand("insertHTML", false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>&nbsp;`);
    emit();
  }
  function insertTable() {
    const cell = "<td><br></td>";
    const head = "<th><br></th>";
    insertHtml(`<table><thead><tr>${head.repeat(3)}</tr></thead><tbody><tr>${cell.repeat(3)}</tr><tr>${cell.repeat(3)}</tr></tbody></table><p><br></p>`);
  }

  // ---------- Markdown 快捷输入 ----------
  function markdownShortcut(): boolean {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.anchorNode) return false;
    const node = sel.anchorNode;
    if (node.nodeType !== Node.TEXT_NODE || !editor.current?.contains(node)) return false;
    const parent = node.parentElement as HTMLElement | null;
    if (!parent || parent.closest("li, pre, table, blockquote, h1, h2, h3")) return false;
    // 光标所在行（块）的开头必须就是这个文本节点
    const block = parent === editor.current ? null : parent.closest("p, div");
    if (block && block !== editor.current && block.firstChild !== node) return false;
    if (!block && node.previousSibling && node.previousSibling.nodeName !== "BR") return false;
    const before = (node.textContent || "").slice(0, sel.anchorOffset);
    const rules: [RegExp, () => void][] = [
      [/^###$/, () => document.execCommand("formatBlock", false, "h3")],
      [/^##$/, () => document.execCommand("formatBlock", false, "h2")],
      [/^#$/, () => document.execCommand("formatBlock", false, "h1")],
      [/^[-*]$/, () => document.execCommand("insertUnorderedList")],
      [/^1[.、]$/, () => document.execCommand("insertOrderedList")],
      [/^>$/, () => document.execCommand("formatBlock", false, "blockquote")],
      [/^```$/, () => document.execCommand("formatBlock", false, "pre")],
      [/^\[\s?\]$/, () => todo()],
    ];
    const hit = rules.find(([re]) => re.test(before));
    if (!hit) return false;
    const r = document.createRange();
    r.setStart(node, 0);
    r.setEnd(node, sel.anchorOffset);
    sel.removeAllRanges();
    sel.addRange(r);
    document.execCommand("delete");
    hit[1]();
    refreshState();
    emit();
    return true;
  }

  function exec(cmd: string, value?: string) {
    restoreSelection();
    document.execCommand(cmd, false, value);
    refreshState();
    emit();
  }

  function block(tag: "blockquote" | "pre") {
    restoreSelection();
    const sel = window.getSelection();
    const node = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement;
    const inside = node?.closest(tag);
    document.execCommand("formatBlock", false, inside ? "p" : tag);
    refreshState();
    emit();
  }

  function todo() {
    restoreSelection();
    const sel = window.getSelection();
    const node = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement;
    let ul = node?.closest("ul");
    if (ul?.classList.contains("doc-todo")) {
      ul.classList.remove("doc-todo");
      document.execCommand("insertUnorderedList");
    } else {
      if (!ul) document.execCommand("insertUnorderedList");
      const again = window.getSelection()?.anchorNode;
      ul = (again instanceof Element ? again : again?.parentElement)?.closest("ul");
      ul?.classList.add("doc-todo");
    }
    refreshState();
    emit();
  }

  function refreshState() {
    if (composing.current) return;
    try {
      const sel = window.getSelection();
      const node = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement;
      if (!node || !editor.current?.contains(node)) return;
      setActive({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strike: document.queryCommandState("strikeThrough"),
        ol: Boolean(node.closest("ol")),
        ul: Boolean(node.closest("ul:not(.doc-todo)")),
        todo: Boolean(node.closest("ul.doc-todo")),
        quote: Boolean(node.closest("blockquote")),
        code: Boolean(node.closest("pre")),
        block: node.closest("h1, h2, h3")?.tagName.toLowerCase() || "p",
      } as unknown as Record<string, boolean> & { block?: string });
    } catch {
      /* queryCommandState 在个别浏览器不可用 */
    }
  }

  function insertHtml(html: string) {
    restoreSelection();
    document.execCommand("insertHTML", false, html);
    saveSelection();
    emit();
  }

  async function upload(files: File[], kind: "image" | "file") {
    for (const file of files) {
      setUploading((n) => n + 1);
      try {
        const att = await uploadAttachment(file, kind, ownerType);
        if (kind === "image") insertHtml(`<p><img src="${att.url}" alt="${escapeHtml(att.name)}"></p><p><br></p>`);
        else insertHtml(`<a href="${att.url}">📎 ${escapeHtml(att.name)}</a>&nbsp;`);
      } catch (e) {
        toast.error(`「${file.name}」上传失败：${e instanceof Error ? e.message : "请重试"}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (images.length) {
      e.preventDefault();
      saveSelection();
      void upload(images, "image");
      return;
    }
    // 外部 HTML 里的图片地址不在白名单内，保存时会被清掉；这里统一按纯文本粘贴，避免带进杂乱样式
    const html = e.clipboardData.getData("text/html");
    if (html) {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      document.execCommand("insertText", false, text);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    e.preventDefault();
    const pos = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(
      e.clientX,
      e.clientY,
    );
    if (pos) savedRange.current = pos;
    const images = files.filter((f) => f.type.startsWith("image/"));
    const others = files.filter((f) => !f.type.startsWith("image/"));
    void upload(images, "image").then(() => upload(others, "file"));
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLImageElement) {
      setImg(t);
      return;
    }
    const li = t.closest("ul.doc-todo > li") as HTMLElement | null;
    if (li && li === t && e.clientX - li.getBoundingClientRect().left < 24) {
      if (li.dataset.checked === "true") delete li.dataset.checked;
      else li.dataset.checked = "true";
      emit();
    }
    if (t.closest("a")) e.preventDefault();
  }

  const groups: Tool[][] = [
    [
      { key: "bold", label: "加粗 ⌘B", Icon: Bold, run: () => exec("bold") },
      { key: "italic", label: "斜体 ⌘I", Icon: Italic, run: () => exec("italic") },
      { key: "underline", label: "下划线 ⌘U", Icon: Underline, run: () => exec("underline") },
      { key: "strike", label: "删除线", Icon: Strikethrough, run: () => exec("strikeThrough") },
    ],
    [
      { key: "left", label: "左对齐", Icon: AlignLeft, run: () => exec("justifyLeft") },
      { key: "center", label: "居中", Icon: AlignCenter, run: () => exec("justifyCenter") },
      { key: "right", label: "右对齐", Icon: AlignRight, run: () => exec("justifyRight") },
    ],
    [
      { key: "ol", label: "有序列表", Icon: ListOrdered, run: () => exec("insertOrderedList") },
      { key: "ul", label: "无序列表", Icon: List, run: () => exec("insertUnorderedList") },
      { key: "todo", label: "待办列表", Icon: ListChecks, run: todo },
    ],
    [
      { key: "quote", label: "引用", Icon: Quote, run: () => block("blockquote") },
      { key: "code", label: "代码块", Icon: Code, run: () => block("pre") },
    ],
    [
      { key: "link", label: "链接 ⌘K", Icon: Link2, run: openLink },
      { key: "image", label: "插入图片（也可粘贴或拖入）", Icon: ImagePlus, run: () => (saveSelection(), imageInput.current?.click()) },
      { key: "file", label: "上传附件", Icon: Paperclip, run: () => (saveSelection(), fileInput.current?.click()) },
      ...(variant === "full" ? [{ key: "table", label: "插入表格", Icon: Table, run: insertTable }] : []),
    ],
  ];

  const bar = (
    <div className="rt-toolbar" role="toolbar" aria-label={`${ariaLabel}格式`}>
      {variant === "full" ? (
        <span className="rt-tb-group">
          <select
            className="rt-tb-select"
            aria-label="段落样式"
            value={active.block || "p"}
            onMouseDown={saveSelection}
            onChange={(e) => {
              exec("formatBlock", e.target.value);
            }}
          >
            <option value="p">正文</option>
            <option value="h1">标题 1</option>
            <option value="h2">标题 2</option>
            <option value="h3">标题 3</option>
          </select>
        </span>
      ) : null}
      {groups.map((g, i) => (
        <span key={i} className="rt-tb-group">
          {g.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`rt-tb-btn${active[t.key] === true ? " is-on" : ""}`}
              aria-label={t.label}
              aria-pressed={t.key in active ? Boolean(active[t.key]) : undefined}
              title={t.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={t.run}
            >
              <t.Icon size={15} aria-hidden="true" />
            </button>
          ))}
        </span>
      ))}
      {linkOpen ? (
        <form
          className="rt-link-pop"
          onSubmit={applyLink}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setLinkOpen(false);
              restoreSelection();
            }
          }}
        >
          <input
            className="input"
            autoFocus
            value={linkUrl}
            placeholder="粘贴或输入链接，回车确认；清空则取消链接"
            aria-label="链接地址"
            onChange={(e) => setLinkUrl(e.target.value)}
          />
          <button type="submit" className="btn-primary nv-head-btn">
            确定
          </button>
          <button type="button" className="btn-ghost nv-head-btn" onClick={() => (setLinkOpen(false), restoreSelection())}>
            取消
          </button>
        </form>
      ) : null}
      {uploading ? <span className="rt-tb-hint">正在上传 {uploading} 个…</span> : null}
      {toolbarEnd ? <span className="rt-tb-end">{toolbarEnd}</span> : null}
    </div>
  );

  return (
    <div className={`rt rt-${variant}${toolbar === "bottom" ? " rt-bar-bottom" : ""}${className ? ` ${className}` : ""}`}>
      {toolbar === "top" ? bar : null}
      <div className="rt-editable-wrap" ref={wrapRef}>
      {/* 占位文字是编辑区旁边的独立元素：不用编辑区自身的 ::before，输入法组字时编辑区不发生任何样式 / 属性变化 */}
      {empty && placeholder ? (
        <div className="rt-editable rt-placeholder doc-content" aria-hidden="true">
          {placeholder}
        </div>
      ) : null}
      <div
        ref={editor}
        className="rt-editable doc-content"
        contentEditable
        suppressContentEditableWarning
        dangerouslySetInnerHTML={seedHtml}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        aria-placeholder={placeholder}
        onInput={(e) => {
          // 组字中的第一个字：先把占位文字藏掉（只改兄弟元素，不碰编辑区）
          if (composing.current) {
            if (empty) setEmpty(false);
            return;
          }
          if (!(e.nativeEvent as InputEvent).isComposing) emit();
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          emit();
        }}
        onKeyUp={() => (saveSelection(), refreshState())}
        onMouseUp={() => (saveSelection(), refreshState())}
        onBlur={saveSelection}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (img && (e.key === "Backspace" || e.key === "Delete")) {
            e.preventDefault();
            deleteImg();
            return;
          }
          if (img) setImg(null);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) {
            e.preventDefault();
            onSubmit();
            return;
          }
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            openLink();
            return;
          }
          if (e.key === " " && markdownShortcut()) e.preventDefault();
        }}
      />
      {img && box ? (
        <>
          <div className="rt-img-sel" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} aria-hidden="true">
            {(["nw", "ne", "sw", "se"] as const).map((c) => (
              <span key={c} className={`rt-img-handle is-${c}`} onPointerDown={(e) => startResize(e, c)} />
            ))}
            <span className="rt-img-size">{Math.round(box.width)} px</span>
          </div>
          <div
            className="rt-img-tools"
            role="toolbar"
            aria-label="图片大小"
            style={{ left: box.left + box.width / 2, top: Math.max(0, box.top - 44) }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {[25, 50, 75, 100].map((pct) => {
              const on = Math.abs(box.width - (maxImgWidth() * pct) / 100) < 4;
              return (
                <button key={pct} type="button" className={on ? "is-on" : undefined} onClick={() => (setImgWidth((maxImgWidth() * pct) / 100), emit())}>
                  {pct}%
                </button>
              );
            })}
            <i aria-hidden="true" />
            <button type="button" aria-label="删除图片" title="删除图片" onClick={deleteImg}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        </>
      ) : null}
      </div>
      {toolbar === "bottom" ? bar : null}
      <input
        ref={imageInput}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          void upload(files, "image");
        }}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          void upload(files, "file");
        }}
      />
    </div>
  );
});
