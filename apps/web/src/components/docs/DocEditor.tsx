"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Bold,
  Check,
  ChevronDown,
  CircleCheck,
  Code,
  Heading2,
  Heading3,
  Info,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table,
  TriangleAlert,
  Underline,
  X,
  type LucideIcon,
  Shapes,
} from "lucide-react";
import { escapeHtml, sanitizeDocHtml } from "@/lib/doc-html";
import { useConfirm } from "@/components/ui/Confirm";
import { useToast } from "@/components/ui/Toast";
import { RefPicker, useDismiss, usePopoverPosition, type RefItem } from "./RefPicker";
import { refreshDocsTree } from "./DocsNav";
import { WorkHeader, type WorkCrumb } from "@/components/layout/WorkHeader";

export type EditorLink = { linkId: string; kind: "req" | "bug"; id: string; code: string; title: string; status: string };

type StatusTag = { key: string; label: string; tone: string };

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/* ------------------------------------------------------------------ */
/* 编辑命令                                                            */
/* ------------------------------------------------------------------ */

function exec(cmd: string, value?: string) {
  document.execCommand(cmd, false, value);
}

function insertHtml(html: string) {
  exec("insertHTML", html);
}

/**
 * 插入块级内容（表格、面板…）后把光标放进去：首个元素打上临时标记，插入后定位并去掉标记。
 * select=true 时选中第一个文本（表头「列 1」可直接改写）。
 */
function insertBlock(html: string, select = false) {
  exec("insertHTML", html.replace(/^<(\w+)/, '<$1 data-doc-new="1"'));
  const el = document.querySelector<HTMLElement>("[data-doc-new]");
  if (!el) return;
  el.removeAttribute("data-doc-new");
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode() as Text | null;
  const range = document.createRange();
  if (first) {
    if (select) range.selectNodeContents(first);
    else {
      range.setStart(first, first.data.length);
      range.collapse(true);
    }
  } else {
    range.selectNodeContents(el.querySelector("td, th, p") || el);
    range.collapse(true);
  }
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function currentBlock(root: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let n: Node | null = sel.getRangeAt(0).startContainer;
  while (n && n !== root) {
    if (n instanceof HTMLElement && /^(P|H1|H2|H3|BLOCKQUOTE|PRE|LI|TD|TH|DIV)$/.test(n.tagName)) return n;
    n = n.parentNode;
  }
  return null;
}

function closest(root: HTMLElement, selector: string): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let n: Node | null = sel.getRangeAt(0).startContainer;
  if (n && !(n instanceof HTMLElement)) n = n.parentNode;
  const el = (n as HTMLElement | null)?.closest?.(selector) as HTMLElement | null;
  return el && root.contains(el) ? el : null;
}

const BLOCK_TYPES = [
  { tag: "P", label: "正文" },
  { tag: "H1", label: "大标题" },
  { tag: "H2", label: "中标题" },
  { tag: "H3", label: "小标题" },
  { tag: "BLOCKQUOTE", label: "引用" },
  { tag: "PRE", label: "代码块" },
] as const;

const COLORS = [
  { key: "", label: "默认" },
  { key: "gray", label: "灰色" },
  { key: "red", label: "红色" },
  { key: "orange", label: "橙色" },
  { key: "green", label: "绿色" },
  { key: "blue", label: "蓝色" },
  { key: "purple", label: "紫色" },
] as const;

const TABLE_HTML =
  '<table class="doc-table"><thead><tr><th>列 1</th><th>列 2</th><th>列 3</th></tr></thead><tbody>' +
  "<tr><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table><p><br></p>";

function panelHtml(tone: "info" | "note" | "warning") {
  const text = tone === "info" ? "提示：" : tone === "note" ? "注意：" : "警告：";
  return `<div class="doc-panel" data-tone="${tone}"><p>${text}</p></div><p><br></p>`;
}

const INLINE_STATUSES = [
  { label: "草稿", tone: "neutral" },
  { label: "评审中", tone: "warning" },
  { label: "评审通过", tone: "success" },
  { label: "进行中", tone: "info" },
  { label: "已阻塞", tone: "danger" },
] as const;

function refHtml(it: RefItem) {
  const href = it.kind === "req" ? `/requirements/${it.id}` : `/bugs?bug=${it.id}`;
  return (
    `<a class="doc-ref" data-ref-kind="${it.kind}" data-ref-id="${it.id}" href="${href}" contenteditable="false">` +
    `<span class="doc-ref-code">${escapeHtml(it.code)}</span><span class="doc-ref-title">${escapeHtml(it.title)}</span>` +
    `<span class="doc-ref-status">${escapeHtml(it.status)}</span></a>&nbsp;`
  );
}

type SlashItem = {
  key: string;
  label: string;
  desc: string;
  Icon: LucideIcon;
  keywords: string;
  group: "基础块" | "高级块";
  /** 返回 "status" / "ref" 表示还要第二步选择；"board" 表示新建一个子画布并插入链接 */
  run: (root: HTMLElement) => void | "status" | "ref" | "board";
};

const SLASH_ITEMS: SlashItem[] = [
  { key: "h2", label: "标题", desc: "中标题，用于分节", Icon: Heading2, keywords: "标题 heading h2 bt", group: "基础块", run: () => exec("formatBlock", "<h2>") },
  { key: "h3", label: "小标题", desc: "节内的小标题", Icon: Heading3, keywords: "小标题 heading h3", group: "基础块", run: () => exec("formatBlock", "<h3>") },
  { key: "ul", label: "列表", desc: "无序列表", Icon: List, keywords: "列表 list ul lb", group: "基础块", run: () => exec("insertUnorderedList") },
  { key: "ol", label: "有序列表", desc: "带编号的步骤", Icon: ListOrdered, keywords: "有序 编号 ol number", group: "基础块", run: () => exec("insertOrderedList") },
  {
    key: "todo",
    label: "待办列表",
    desc: "可勾选，适合会议行动项",
    Icon: ListChecks,
    keywords: "待办 todo task 任务 db",
    group: "基础块",
    run: (root) => makeTodo(root),
  },
  { key: "table", label: "表格", desc: "行列数据，支持表头", Icon: Table, keywords: "表格 table bg", group: "基础块", run: () => insertBlock(TABLE_HTML, true) },
  { key: "quote", label: "引用", desc: "引用一段话", Icon: Quote, keywords: "引用 quote yy", group: "基础块", run: () => exec("formatBlock", "<blockquote>") },
  { key: "code", label: "代码块", desc: "等宽字体，保留空格", Icon: Code, keywords: "代码 code pre dm", group: "基础块", run: () => exec("formatBlock", "<pre>") },
  { key: "hr", label: "分割线", desc: "分隔不同内容", Icon: Minus, keywords: "分割线 divider hr fgx", group: "基础块", run: () => insertHtml("<hr><p><br></p>") },
  { key: "info", label: "信息面板", desc: "提示、注意、警告三种样式", Icon: Info, keywords: "信息 面板 提示 panel info xx", group: "高级块", run: () => insertBlock(panelHtml("info")) },
  { key: "note", label: "注意面板", desc: "黄色，提醒需要留意的事项", Icon: TriangleAlert, keywords: "注意 note 面板 zy", group: "高级块", run: () => insertBlock(panelHtml("note")) },
  { key: "warning", label: "警告面板", desc: "红色，风险或不可逆操作", Icon: TriangleAlert, keywords: "警告 warning 面板 jg", group: "高级块", run: () => insertBlock(panelHtml("warning")) },
  { key: "status", label: "状态标签", desc: "草稿、评审中、评审通过", Icon: CircleCheck, keywords: "状态 status 标签 zt", group: "高级块", run: () => "status" },
  { key: "ref", label: "关联需求", desc: "插入 REQ / BUG，实时显示状态", Icon: Link2, keywords: "关联 需求 bug req 引用 gl", group: "高级块", run: () => "ref" },
  { key: "board", label: "画布", desc: "新建一个子画布（流程图、架构图）并插入链接", Icon: Shapes, keywords: "画布 白板 流程图 架构图 board whiteboard hb lct", group: "高级块", run: () => "board" },
];

function makeTodo(root: HTMLElement) {
  const inList = closest(root, "ul");
  if (!inList) exec("insertUnorderedList");
  const ul = closest(root, "ul");
  if (ul) ul.classList.add("doc-todo");
}

/* ------------------------------------------------------------------ */
/* 小浮层：工具栏下拉                                                   */
/* ------------------------------------------------------------------ */

function Dropdown({
  anchor,
  onClose,
  width = 200,
  children,
  label,
}: {
  anchor: DOMRect | null;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(anchor, width, 320);
  useDismiss(Boolean(anchor), box, onClose);
  if (!anchor || !pos) return null;
  return createPortal(
    <div ref={box} className="doc-popover" style={{ top: pos.top, left: pos.left, width }} role="menu" aria-label={label}>
      {children}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* 编辑器                                                              */
/* ------------------------------------------------------------------ */

export function DocEditor({
  page,
  spaceId,
  statusTags,
  initialLinks,
  crumbs,
}: {
  crumbs: WorkCrumb[];
  page: {
    id: string;
    title: string;
    html: string;
    statusTag: string | null;
    version: number;
    draftSavedAt: string | null;
    parentId: string | null;
  };
  spaceId: string;
  statusTags: readonly StatusTag[];
  initialLinks: EditorLink[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(page.title);
  const [save, setSave] = useState<SaveState>(page.draftSavedAt ? "saved" : "idle");
  const [savedAt, setSavedAt] = useState<Date | null>(page.draftSavedAt ? new Date(page.draftSavedAt) : null);
  const [, forceTick] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [statusTag, setStatusTag] = useState<string | null>(page.statusTag);
  const [links, setLinks] = useState<EditorLink[]>(initialLinks);
  const [blockLabel, setBlockLabel] = useState("正文");
  const [marks, setMarks] = useState({ bold: false, italic: false, underline: false, strike: false });

  // 浮层
  const [menu, setMenu] = useState<null | { kind: string; rect: DOMRect }>(null);
  const [slash, setSlash] = useState<null | { rect: DOMRect; query: string; active: number; node: Text; start: number }>(null);
  const [step2, setStep2] = useState<null | { kind: "status" | "ref" | "pageRef"; rect: DOMRect }>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const savedRange = useRef<Range | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const timer = useRef<number | null>(null);
  const slashDismissed = useRef<{ node: Text; start: number } | null>(null);
  const treeTitle = useRef(page.title);

  /* ---------- 初始化 ---------- */
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = page.html || "<p><br></p>";
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
      document.execCommand("styleWithCSS", false, "false");
    } catch {
      /* 老浏览器忽略 */
    }
    if (!page.title) titleRef.current?.focus();
    // 只在挂载时写入初始内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 「刚刚 / N 分钟前」每 30 秒刷新一次
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // 标题输入框自动增高
  useEffect(() => {
    const t = titleRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }, [title]);

  /* ---------- 自动保存 ---------- */
  const doSave = useCallback(async (): Promise<boolean> => {
    const el = editorRef.current;
    if (!el) return false;
    if (savingRef.current) return false;
    savingRef.current = true;
    dirtyRef.current = false;
    setSave("saving");
    try {
      const res = await fetch(`/api/docs/pages/${page.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titleRef.current?.value ?? "", body: el.innerHTML }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "保存失败");
      }
      setSavedAt(new Date());
      setSave(dirtyRef.current ? "dirty" : "saved");
      // 标题变了就刷新侧栏页面树
      const t = titleRef.current?.value ?? "";
      if (t !== treeTitle.current) {
        treeTitle.current = t;
        refreshDocsTree();
      }
      return true;
    } catch (e) {
      dirtyRef.current = true;
      setSave("error");
      if (e instanceof Error && e.message !== "保存失败") toast.error(e.message);
      return false;
    } finally {
      savingRef.current = false;
      if (dirtyRef.current && timer.current == null) schedule();
    }
    // schedule 在下面定义，引用稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, toast]);

  const schedule = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void doSave();
    }, 1200);
  }, [doSave]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setSave("dirty");
    schedule();
  }, [schedule]);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyRef.current || savingRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  /* ---------- 选区与工具栏状态 ---------- */
  useEffect(() => {
    function onSel() {
      const root = editorRef.current;
      if (!root) return;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !root.contains(sel.anchorNode)) return;
      savedRange.current = sel.getRangeAt(0).cloneRange();
      const block = currentBlock(root);
      const tag = block?.tagName || "P";
      setBlockLabel(BLOCK_TYPES.find((b) => b.tag === tag)?.label || "正文");
      setMarks({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strike: document.queryCommandState("strikeThrough"),
      });
    }
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  function restoreSelection() {
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    const r = savedRange.current;
    if (r && root.contains(r.startContainer)) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    } else {
      // 没有选区时放到末尾
      const range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }

  function run(fn: () => void) {
    restoreSelection();
    fn();
    markDirty();
  }

  function openMenu(kind: string, e: React.MouseEvent<HTMLElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu((m) => (m?.kind === kind ? null : { kind, rect }));
  }

  function applyColor(key: string) {
    const root = editorRef.current;
    if (!root) return;
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    // 先去掉选区里已有的颜色
    root.querySelectorAll<HTMLElement>("span[class^='doc-color-']").forEach((span) => {
      if (range.intersectsNode(span)) {
        span.replaceWith(...Array.from(span.childNodes));
      }
    });
    if (key && !range.collapsed) {
      const holder = document.createElement("div");
      holder.appendChild(range.cloneContents());
      insertHtml(`<span class="doc-color-${key}">${holder.innerHTML}</span>`);
    }
    markDirty();
  }

  /* ---------- 「/」菜单 ---------- */
  const slashItems = slash
    ? SLASH_ITEMS.filter((it) => !slash.query || `${it.label} ${it.keywords}`.toLowerCase().includes(slash.query.toLowerCase()))
    : [];

  function detectSlash() {
    const root = editorRef.current;
    const sel = window.getSelection();
    if (!root || !sel || !sel.isCollapsed || !sel.rangeCount) {
      setSlash(null);
      return;
    }
    const node = sel.anchorNode;
    if (!(node instanceof Text) || !root.contains(node)) {
      setSlash(null);
      return;
    }
    const before = node.data.slice(0, sel.anchorOffset);
    const m = /(?:^|[\s ])\/([^\s/]{0,12})$/.exec(before);
    if (!m) {
      setSlash(null);
      slashDismissed.current = null;
      return;
    }
    const start = sel.anchorOffset - m[1].length - 1;
    const d = slashDismissed.current;
    if (d && d.node === node && d.start === start) return;
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, sel.anchorOffset);
    const rect = r.getBoundingClientRect();
    setSlash((s) => ({ rect, query: m[1], active: s && s.query === m[1] ? s.active : 0, node, start }));
  }

  function chooseSlash(item: SlashItem) {
    const root = editorRef.current;
    if (!root || !slash) return;
    // 删掉 "/关键字"
    const sel = window.getSelection();
    const r = document.createRange();
    const end = Math.min(slash.node.data.length, slash.start + 1 + slash.query.length);
    r.setStart(slash.node, slash.start);
    r.setEnd(slash.node, end);
    r.deleteContents();
    sel?.removeAllRanges();
    sel?.addRange(r);
    const rect = slash.rect;
    setSlash(null);
    root.focus();
    const next = item.run(root);
    if (next === "board") {
      void insertBoard();
      return;
    }
    if (next === "status" || next === "ref") {
      savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      setStep2({ kind: next, rect });
    }
    markDirty();
  }

  /** 「/画布」：在本页下新建一个子画布，正文里插入指向它的链接，保存后跳去画 */
  async function insertBoard() {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const res = await fetch("/api/docs/pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spaceId, parentId: page.id, title: "", kind: "board", template: "blank" }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error || "新建画布失败");
    editorRef.current?.focus();
    if (range) {
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    const href = `/docs/${spaceId}/pages/${data.id}`;
    insertHtml(`<a class="doc-board-link" href="${href}">画布：点击打开编辑</a>&nbsp;`);
    markDirty();
    refreshDocsTree();
    const ok = await doSave();
    if (ok && (await confirm({ title: "现在去画布？", body: "已在本页下新建了一个子画布，正文里插入了它的链接。草稿已保存，可以现在去画，也可以稍后点链接进入。", confirmLabel: "去画布", cancelLabel: "稍后" }))) {
      router.push(`${href}/edit`);
    }
  }

  /* ---------- 键盘 ---------- */
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const root = editorRef.current!;
    if (slash && slashItems.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setSlash({ ...slash, active: (slash.active + d + slashItems.length) % slashItems.length });
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
        e.preventDefault();
        chooseSlash(slashItems[slash.active] || slashItems[0]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        slashDismissed.current = { node: slash.node, start: slash.start };
        setSlash(null);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void doSave();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const r = root.getBoundingClientRect();
      setMenu({ kind: "link", rect: new DOMRect(r.left + 40, r.top, 0, 0) });
      return;
    }
    // 表格里 Tab 跳到下一格，最后一格再按 Tab 新增一行
    if (e.key === "Tab") {
      const cell = closest(root, "td, th");
      if (cell) {
        e.preventDefault();
        const table = cell.closest("table")!;
        const cells = Array.from(table.querySelectorAll<HTMLElement>("th, td"));
        const idx = cells.indexOf(cell);
        let target = cells[idx + (e.shiftKey ? -1 : 1)];
        if (!target && !e.shiftKey) {
          const row = cell.closest("tr")!;
          const tr = document.createElement("tr");
          for (let i = 0; i < row.children.length; i++) {
            const td = document.createElement("td");
            td.innerHTML = "<br>";
            tr.appendChild(td);
          }
          (table.tBodies[0] || table).appendChild(tr);
          target = tr.children[0] as HTMLElement;
          markDirty();
        }
        if (target) {
          // 选中整格内容，直接输入即可覆盖（与表格软件一致）；空格子只放光标
          const range = document.createRange();
          range.selectNodeContents(target);
          if (!(target.textContent || "").trim()) range.collapse(true);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
        return;
      }
    }
    // Markdown 快捷方式：行首输入 "# " "## " "- " "1. " "> " "[] " 后按空格
    if (e.key === " " && !e.shiftKey) {
      const sel = window.getSelection();
      const block = currentBlock(root);
      if (sel && sel.isCollapsed && block && block.tagName === "P") {
        const node = sel.anchorNode;
        if (node instanceof Text && block.firstChild === node) {
          const prefix = node.data.slice(0, sel.anchorOffset);
          const map: Record<string, () => void> = {
            "#": () => exec("formatBlock", "<h1>"),
            "##": () => exec("formatBlock", "<h2>"),
            "###": () => exec("formatBlock", "<h3>"),
            "-": () => exec("insertUnorderedList"),
            "*": () => exec("insertUnorderedList"),
            "1.": () => exec("insertOrderedList"),
            ">": () => exec("formatBlock", "<blockquote>"),
            "[]": () => makeTodo(root),
            "```": () => exec("formatBlock", "<pre>"),
          };
          const fn = map[prefix];
          if (fn) {
            e.preventDefault();
            const r = document.createRange();
            r.setStart(node, 0);
            r.setEnd(node, sel.anchorOffset);
            r.deleteContents();
            if (!block.textContent) block.innerHTML = "<br>";
            const c = document.createRange();
            c.selectNodeContents(block);
            c.collapse(true);
            sel.removeAllRanges();
            sel.addRange(c);
            fn();
            markDirty();
          }
        }
      }
    }
  }

  function onEditorClick(e: React.MouseEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    // 待办：点左侧复选框区域切换勾选
    const li = t.closest("ul.doc-todo > li") as HTMLElement | null;
    if (li && li === t) {
      const x = e.clientX - li.getBoundingClientRect().left;
      if (x < 24) {
        if (li.dataset.checked === "true") delete li.dataset.checked;
        else li.dataset.checked = "true";
        markDirty();
      }
    }
    // 引用块在编辑态不跳转
    if (t.closest("a.doc-ref")) e.preventDefault();
  }

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    e.preventDefault();
    if (html) {
      insertHtml(sanitizeDocHtml(html));
    } else if (text) {
      const parts = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
      if (parts.length === 1) insertHtml(escapeHtml(text).replace(/\n/g, "<br>"));
      else insertHtml(parts.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join(""));
    }
    markDirty();
  }

  /* ---------- 第二步：状态标签 / 关联需求 ---------- */
  function insertStatus(s: (typeof INLINE_STATUSES)[number]) {
    setStep2(null);
    run(() => insertHtml(`<span class="doc-status" data-tone="${s.tone}" contenteditable="false">${s.label}</span>&nbsp;`));
  }

  function insertRef(it: RefItem) {
    setStep2(null);
    setMenu(null);
    run(() => insertHtml(refHtml(it)));
  }

  async function addPageLink(it: RefItem) {
    setStep2(null);
    if (links.some((l) => l.kind === it.kind && l.id === it.id)) return;
    const res = await fetch(`/api/docs/pages/${page.id}/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: it.kind, id: it.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "关联失败");
      return;
    }
    setLinks((ls) => [...ls, { linkId: data.id, ...it }]);
  }

  async function removePageLink(l: EditorLink) {
    const res = await fetch(`/api/docs/pages/${page.id}/links?linkId=${encodeURIComponent(l.linkId)}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("取消关联失败，请重试");
      return;
    }
    setLinks((ls) => ls.filter((x) => x.linkId !== l.linkId));
  }

  async function changeStatusTag(key: string | null) {
    setMenu(null);
    const prev = statusTag;
    setStatusTag(key);
    const res = await fetch(`/api/docs/pages/${page.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusTag: key }),
    });
    if (!res.ok) {
      setStatusTag(prev);
      toast.error("修改页面状态失败");
    }
  }

  /* ---------- 发布 / 取消 ---------- */
  async function publish() {
    const el = editorRef.current;
    if (!el) return;
    const t = (titleRef.current?.value || "").trim();
    if (!t) {
      toast.error("请先填写页面标题");
      titleRef.current?.focus();
      return;
    }
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setPublishing(true);
    try {
      const res = await fetch(`/api/docs/pages/${page.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, body: el.innerHTML }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "发布失败");
      dirtyRef.current = false;
      refreshDocsTree();
      toast.success(page.version === 0 ? "页面已发布" : `已发布第 ${data.version} 版`);
      router.push(`/docs/${spaceId}/pages/${page.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "发布失败");
      setPublishing(false);
    }
  }

  async function cancel() {
    const el = editorRef.current;
    const empty = !(titleRef.current?.value || "").trim() && !(el?.textContent || "").trim();
    const hasDraft = save !== "idle";
    if (page.version > 0 && !hasDraft) {
      router.push(`/docs/${spaceId}/pages/${page.id}`);
      return;
    }
    if (!(page.version === 0 && empty)) {
      const ok = await confirm({
        title: page.version === 0 ? "放弃这个新页面？" : "放弃本次修改？",
        body:
          page.version === 0
            ? "页面还没有发布，放弃后草稿会被删除。想稍后再写，可以直接离开本页，草稿会自动保留。"
            : "未发布的修改会被丢弃，已发布的内容不受影响。想稍后再写，可以直接离开本页，草稿会自动保留。",
        confirmLabel: page.version === 0 ? "放弃并删除" : "放弃修改",
        tone: "danger",
      });
      if (!ok) return;
    }
    if (timer.current != null) window.clearTimeout(timer.current);
    dirtyRef.current = false;
    const res = await fetch(`/api/docs/pages/${page.id}/draft`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "操作失败，请重试");
      return;
    }
    refreshDocsTree();
    if (data.deleted) {
      router.push(page.parentId ? `/docs/${spaceId}/pages/${page.parentId}` : `/docs/${spaceId}`);
    } else {
      router.push(`/docs/${spaceId}/pages/${page.id}`);
    }
    router.refresh();
  }

  /* ---------- 渲染 ---------- */
  const tag = statusTags.find((t) => t.key === statusTag) || null;
  const saveText =
    save === "saving"
      ? "正在保存…"
      : save === "dirty"
        ? "有未保存的修改"
        : save === "error"
          ? "保存失败"
          : save === "saved" && savedAt
            ? `草稿已自动保存 · ${relTime(savedAt)}`
            : page.version === 0
              ? "新页面 · 尚未发布"
              : `已发布第 ${page.version} 版`;

  const tb = (label: string, Icon: LucideIcon, fn: () => void, pressed?: boolean, shortcut?: string) => (
    <button
      type="button"
      className={`doc-tb-btn${pressed ? " is-on" : ""}`}
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      title={shortcut ? `${label}（${shortcut}）` : label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run(fn)}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );

  const mod = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl+";

  return (
    <div className="doc-editor">
      <WorkHeader
        crumbs={crumbs}
        actions={
          <>
            <span className={`doc-save-state${save === "error" ? " is-error" : ""}`} role="status" aria-live="polite">
              {saveText}
              {save === "error" ? (
                <button type="button" className="text-link" onClick={() => void doSave()}>
                  重试
                </button>
              ) : null}
            </span>
            <button type="button" className="btn-secondary nv-head-btn" onClick={() => void cancel()} disabled={publishing}>
              取消
            </button>
            <button type="button" className="btn-primary nv-head-btn" onClick={() => void publish()} disabled={publishing} aria-busy={publishing}>
              {page.version === 0 ? "发布" : "更新"}
            </button>
          </>
        }
      />

      <div className="doc-toolbar" role="toolbar" aria-label="格式">
        <button
          type="button"
          className="doc-tb-select"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "block"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => openMenu("block", e)}
        >
          {blockLabel}
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="doc-tb-select"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "color"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => openMenu("color", e)}
        >
          颜色
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <span className="doc-tb-sep" aria-hidden="true" />
        {tb("加粗", Bold, () => exec("bold"), marks.bold, `${mod}B`)}
        {tb("斜体", Italic, () => exec("italic"), marks.italic, `${mod}I`)}
        {tb("下划线", Underline, () => exec("underline"), marks.underline, `${mod}U`)}
        {tb("删除线", Strikethrough, () => exec("strikeThrough"), marks.strike)}
        <span className="doc-tb-sep" aria-hidden="true" />
        {tb("无序列表", List, () => exec("insertUnorderedList"))}
        {tb("有序列表", ListOrdered, () => exec("insertOrderedList"))}
        {tb("待办列表", ListChecks, () => makeTodo(editorRef.current!))}
        <button
          type="button"
          className="doc-tb-btn"
          aria-label="链接"
          title={`链接（${mod}K）`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            setLinkUrl("");
            openMenu("link", e);
          }}
        >
          <Link2 size={16} aria-hidden="true" />
        </button>
        {tb("表格", Table, () => insertBlock(TABLE_HTML, true))}
        {tb("信息面板", Info, () => insertBlock(panelHtml("info")))}
        <span className="doc-tb-sep" aria-hidden="true" />
        <button
          type="button"
          className="doc-tb-select"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "insert"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => openMenu("insert", e)}
        >
          插入
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="doc-tb-select"
          aria-haspopup="dialog"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => setStep2({ kind: "ref", rect: e.currentTarget.getBoundingClientRect() })}
        >
          @ 关联需求
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <span className="doc-tb-hint">输入「/」插入内容</span>
      </div>

      <div className="doc-canvas">
        <div className="doc-meta-row">
          {page.version === 0 ? (
            <span className="doc-chip tone-neutral">
              <span className="doc-dot" aria-hidden="true" />
              草稿
            </span>
          ) : null}
          {tag ? (
            <button
              type="button"
              className={`doc-chip tone-${tag.tone}`}
              onClick={(e) => openMenu("status", e)}
              aria-haspopup="menu"
              title="修改页面状态"
            >
              <span className="doc-dot" aria-hidden="true" />
              {tag.label}
            </button>
          ) : (
            <button type="button" className="doc-add-chip" onClick={(e) => openMenu("status", e)} aria-haspopup="menu">
              + 添加状态
            </button>
          )}
          {links.map((l) => (
            <span key={l.linkId} className="doc-chip doc-link-chip" title={`${l.title} · ${l.status}`}>
              {l.code}
              <button type="button" aria-label={`取消关联 ${l.code}`} onClick={() => void removePageLink(l)}>
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
          <button
            type="button"
            className="doc-add-chip"
            onClick={(e) => setStep2({ kind: "pageRef", rect: e.currentTarget.getBoundingClientRect() })}
          >
            + 关联需求
          </button>
        </div>
        <textarea
          ref={titleRef}
          className="doc-title-input"
          rows={1}
          placeholder="页面标题"
          aria-label="页面标题"
          value={title}
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value);
            markDirty();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              editorRef.current?.focus();
            }
          }}
        />
        <div
          ref={editorRef}
          className="doc-content doc-editable"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="页面正文"
          data-placeholder="输入正文，或输入「/」插入标题、列表、表格、信息面板、关联需求…"
          onInput={() => {
            markDirty();
            detectSlash();
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => {
            if (!["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(e.key)) detectSlash();
          }}
          onClick={onEditorClick}
          onPaste={onPaste}
          onBlur={() => setTimeout(() => setSlash(null), 150)}
        />
      </div>

      {/* 「/」插入菜单 */}
      {slash && slashItems.length ? (
        <SlashMenu items={slashItems} active={slash.active} rect={slash.rect} onChoose={chooseSlash} />
      ) : null}

      {/* 工具栏下拉 */}
      <Dropdown anchor={menu?.kind === "block" ? menu.rect : null} onClose={() => setMenu(null)} label="段落样式" width={160}>
        <ul className="doc-menu-list">
          {BLOCK_TYPES.map((b) => (
            <li key={b.tag}>
              <button
                type="button"
                role="menuitem"
                className={`doc-menu-item${blockLabel === b.label ? " is-active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMenu(null);
                  run(() => exec("formatBlock", `<${b.tag.toLowerCase()}>`));
                }}
              >
                <span className={`doc-menu-title doc-sample-${b.tag.toLowerCase()}`}>{b.label}</span>
                {blockLabel === b.label ? <Check size={14} aria-hidden="true" className="ml-auto" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </Dropdown>
      <Dropdown anchor={menu?.kind === "color" ? menu.rect : null} onClose={() => setMenu(null)} label="文字颜色" width={160}>
        <ul className="doc-menu-list">
          {COLORS.map((c) => (
            <li key={c.key || "default"}>
              <button
                type="button"
                role="menuitem"
                className="doc-menu-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMenu(null);
                  applyColor(c.key);
                }}
              >
                <span className={`doc-swatch${c.key ? ` doc-color-${c.key}` : ""}`} aria-hidden="true">
                  A
                </span>
                <span className="doc-menu-title">{c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </Dropdown>
      <Dropdown anchor={menu?.kind === "insert" ? menu.rect : null} onClose={() => setMenu(null)} label="插入" width={280}>
        <SlashList
          items={SLASH_ITEMS}
          active={-1}
          onChoose={(item) => {
            const rect = menu!.rect;
            setMenu(null);
            restoreSelection();
            const next = item.run(editorRef.current!);
            if (next === "status" || next === "ref") {
              const sel = window.getSelection();
              savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
              setStep2({ kind: next, rect });
            }
            markDirty();
          }}
        />
      </Dropdown>
      <Dropdown anchor={menu?.kind === "status" ? menu.rect : null} onClose={() => setMenu(null)} label="页面状态" width={180}>
        <ul className="doc-menu-list">
          {statusTags.map((t) => (
            <li key={t.key}>
              <button type="button" role="menuitem" className="doc-menu-item" onClick={() => void changeStatusTag(t.key)}>
                <span className={`doc-chip tone-${t.tone}`}>
                  <span className="doc-dot" aria-hidden="true" />
                  {t.label}
                </span>
                {statusTag === t.key ? <Check size={14} aria-hidden="true" className="ml-auto" /> : null}
              </button>
            </li>
          ))}
          {statusTag ? (
            <li>
              <button type="button" role="menuitem" className="doc-menu-item" onClick={() => void changeStatusTag(null)}>
                <span className="doc-menu-title">清除状态</span>
              </button>
            </li>
          ) : null}
        </ul>
      </Dropdown>
      <Dropdown anchor={menu?.kind === "link" ? menu.rect : null} onClose={() => setMenu(null)} label="插入链接" width={300}>
        <form
          className="doc-link-form"
          onSubmit={(e) => {
            e.preventDefault();
            const url = linkUrl.trim();
            if (!/^(https?:\/\/|mailto:|\/)/i.test(url)) {
              toast.error("请输入以 http(s):// 开头的链接");
              return;
            }
            setMenu(null);
            run(() => {
              const sel = window.getSelection();
              if (sel && !sel.isCollapsed) exec("createLink", url);
              else insertHtml(`<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>&nbsp;`);
            });
          }}
        >
          <input
            autoFocus
            className="input"
            placeholder="https://"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            aria-label="链接地址"
          />
          <button type="submit" className="btn-primary">
            插入
          </button>
        </form>
      </Dropdown>
      <Dropdown anchor={step2?.kind === "status" ? step2.rect : null} onClose={() => setStep2(null)} label="状态标签" width={180}>
        <ul className="doc-menu-list">
          {INLINE_STATUSES.map((s) => (
            <li key={s.label}>
              <button type="button" role="menuitem" className="doc-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => insertStatus(s)}>
                <span className="doc-status" data-tone={s.tone}>
                  {s.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Dropdown>
      <RefPicker
        spaceId={spaceId}
        anchor={step2?.kind === "ref" || step2?.kind === "pageRef" ? step2.rect : null}
        title={step2?.kind === "pageRef" ? "关联到本页" : "插入需求或 Bug"}
        onClose={() => setStep2(null)}
        onPick={(it) => (step2?.kind === "pageRef" ? void addPageLink(it) : insertRef(it))}
      />
    </div>
  );
}

function SlashList({ items, active, onChoose }: { items: SlashItem[]; active: number; onChoose: (it: SlashItem) => void }) {
  const groups = ["基础块", "高级块"] as const;
  let i = -1;
  return (
    <div className="doc-slash-list">
      {groups.map((g) => {
        const list = items.filter((it) => it.group === g);
        if (!list.length) return null;
        return (
          <div key={g} role="group" aria-label={g}>
            <p className="doc-menu-group">{g}</p>
            <ul className="doc-menu-list">
              {list.map((it) => {
                i += 1;
                const on = i === active;
                return (
                  <li key={it.key}>
                    <button
                      type="button"
                      role="menuitem"
                      className={`doc-menu-item${on ? " is-active" : ""}`}
                      ref={on ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onChoose(it)}
                    >
                      <span className="doc-menu-icon">
                        <it.Icon size={16} aria-hidden="true" />
                      </span>
                      <span className="doc-menu-text">
                        <span className="doc-menu-title">{it.label}</span>
                        <span className="doc-menu-desc">{it.desc}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function SlashMenu({
  items,
  active,
  rect,
  onChoose,
}: {
  items: SlashItem[];
  active: number;
  rect: DOMRect;
  onChoose: (it: SlashItem) => void;
}) {
  const pos = usePopoverPosition(rect, 290, 380);
  if (!pos) return null;
  return createPortal(
    <div className="doc-popover doc-slash" style={{ top: pos.top, left: pos.left }} role="menu" aria-label="插入内容">
      <SlashList items={items} active={active} onChoose={onChoose} />
    </div>,
    document.body,
  );
}

function relTime(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 45) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
