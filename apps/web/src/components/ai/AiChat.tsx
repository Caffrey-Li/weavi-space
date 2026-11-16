"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Copy, Cpu, Folder, FolderOpen, Hand, X } from "lucide-react";
import { readLocalFolder, type LocalFolder } from "@/lib/local-folder";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/Confirm";
import { AI_CHATS_CHANGED, AI_TASKS_CHANGED } from "./AiNav";
import { ACTIVE, AgentRun, type AgentTaskView } from "./AgentRun";
import { Markdown } from "./Markdown";
import { XiaoweiAvatar, type XiaoweiState } from "./XiaoweiAvatar";

type Option = { credentialId: string; model: string; label: string; source: "enterprise" | "personal"; disabled: boolean; reason?: string };
type Msg = { id: string; role: "user" | "assistant"; content: string; action?: Record<string, unknown> | null; actionStatus?: string | null; actionResult?: string | null; agentTaskId?: string | null; error?: boolean };
type Scope = { kind: "none" | "workspace" | "project" | "local"; projectId?: string };

const SUGGESTIONS = ["哪些需求已经逾期？", "本周新增了哪些 Bug？", "各项目进度怎么样？", "帮我在项目里新建一个需求"];
const ACTION_LABEL: Record<string, string> = {
  create_requirement: "新建需求",
  create_bug: "新建 Bug",
  update_requirement_status: "修改需求状态",
  update_bug_status: "修改 Bug 状态",
};

function actionText(a: Record<string, unknown>, projects: { id: string; name: string }[]) {
  const p = projects.find((x) => x.id === a.projectId)?.name;
  if (a.type === "create_requirement" || a.type === "create_bug") return `${p ? `在「${p}」` : ""}${ACTION_LABEL[String(a.type)]}「${String(a.title || "")}」`;
  return `${ACTION_LABEL[String(a.type)] || "操作"}为 ${String(a.status || "")}`;
}

/** 回答旁的小围：动手任务按任务状态（查资料 / 动手 / 等确认 / 完成），出错时睡着，刚答完的挥手一次 */
function avatarState(m: Msg, task: AgentTaskView | undefined, fresh: boolean): XiaoweiState {
  if (m.error) return "error";
  if (task) {
    if (task.status === "waiting") return "waiting";
    if (task.status === "queued") return "thinking";
    if (task.status === "running") {
      const last = [...task.stepRows].reverse().find((s) => s.kind === "tool");
      return last?.level === "read" ? "searching" : last ? "working" : "thinking";
    }
    if (task.status === "failed") return "error";
    if (task.status === "done") return fresh ? "done" : "idle";
    return "idle";
  }
  return fresh ? "done" : "idle";
}

/**
 * AI 对话（图标栏「AI」）：选模型（企业模型在前；企业额度用完不可选）、选范围（不关联数据 / 工作区 / 某个项目），
 * 对话存在服务端。AI 提议的新建 / 修改要点「确认执行」才会做，用你自己的权限。
 */
export function AiChat({ projects }: { projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();
  const chatId = sp.get("c") || "";
  const [messages, setMessages] = useState<Msg[]>([]);
  const [title, setTitle] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<Scope>({ kind: "workspace" });
  const [scopeOpen, setScopeOpen] = useState(false);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [quotaNote, setQuotaNote] = useState("");
  const [pick, setPick] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [local, setLocal] = useState<LocalFolder | null>(null);
  const [reading, setReading] = useState(false);
  // 动手模式：小围自己调工具把事做完（读直接做，写先问）；开关记在本机
  const [agentMode, setAgentMode] = useState(false);
  const [tasks, setTasks] = useState<Record<string, AgentTaskView>>({});
  // 这次打开页面后才收到的回答（历史对话里的不挥手）
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());
  const lastAnswerId = useMemo(() => [...messages].reverse().find((m) => m.role === "assistant")?.id, [messages]);
  const folderRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/ai/models", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { options: Option[]; quota: { limit: number | null; used: number; remaining: number | null } | null }) => {
        setOptions(d.options || []);
        if (d.quota && d.quota.limit !== null) setQuotaNote(`企业额度：已用 ${d.quota.used} / ${d.quota.limit} tokens`);
        const first = (d.options || []).find((o) => !o.disabled);
        setPick((cur) => cur || (first ? `${first.credentialId}|${first.model}` : ""));
      })
      .catch(() => setOptions([]));
  }, []);

  useEffect(() => {
    try {
      setAgentMode(localStorage.getItem("pm-ai-agent") === "1");
    } catch {
      /* 读不到就用默认 */
    }
  }, []);
  function toggleAgent() {
    setAgentMode((v) => {
      try {
        localStorage.setItem("pm-ai-agent", v ? "0" : "1");
      } catch {
        /* 忽略 */
      }
      return !v;
    });
  }

  // 进行中的任务每 1.5 秒刷新一次；等你确认时不刷新（不占用模型，也不轮询）
  const activeIds = Object.values(tasks)
    .filter((t) => t.status === "queued" || t.status === "running")
    .map((t) => t.id)
    .join(",");
  useEffect(() => {
    if (!activeIds) return;
    const timer = setInterval(() => {
      for (const id of activeIds.split(",")) {
        fetch(`/api/ai/agent/${encodeURIComponent(id)}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (!d?.task) return;
            setTasks((m) => ({ ...m, [id]: d.task }));
            if (!ACTIVE.includes(d.task.status)) {
              setMessages((list) => list.map((x) => (x.agentTaskId === id ? { ...x, content: d.task.result || d.task.error || x.content } : x)));
              if (d.task.status === "done") router.refresh();
            }
          })
          .catch(() => undefined);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [activeIds, router]);

  async function resolveTask(id: string, approve: boolean, note: string) {
    const res = await fetch(`/api/ai/agent/${encodeURIComponent(id)}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approve, note }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) toast.error(d.error || "操作失败");
    if (d.task) setTasks((m) => ({ ...m, [id]: d.task }));
    window.dispatchEvent(new Event(AI_TASKS_CHANGED));
  }
  async function stopTask(id: string) {
    const res = await fetch(`/api/ai/agent/${encodeURIComponent(id)}/stop`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) toast.error(d.error || "停止失败");
    if (d.task) {
      setTasks((m) => ({ ...m, [id]: d.task }));
      setMessages((list) => list.map((x) => (x.agentTaskId === id && !x.content ? { ...x, content: "（任务已停止）" } : x)));
    }
    window.dispatchEvent(new Event(AI_TASKS_CHANGED));
  }

  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      setTasks({});
      setTitle("");
      return;
    }
    fetch(`/api/ai/conversations/${encodeURIComponent(chatId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const c = d.conversation;
        setTitle(c.title);
        setMessages(c.messages);
        setTasks(Object.fromEntries(((d.tasks || []) as AgentTaskView[]).map((t) => [t.id, t])));
        setScope({ kind: c.scope, projectId: c.projectId || undefined });
        if (c.credentialId && c.model) setPick(`${c.credentialId}|${c.model}`);
      })
      .catch(() => router.replace("/ai"));
    inputRef.current?.focus();
  }, [chatId, router]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, busy]);

  const picked = options?.find((o) => `${o.credentialId}|${o.model}` === pick) || null;
  const scopeName = useMemo(
    () =>
      scope.kind === "none"
        ? "不关联数据"
        : scope.kind === "workspace"
          ? "工作区（我能看到的全部项目）"
          : scope.kind === "local"
            ? local
              ? `本地 · ${local.name}`
              : "本地文件夹（请重新选择）"
            : projects.find((p) => p.id === scope.projectId)?.name || "项目",
    [scope, projects, local],
  );

  async function onFolder(list: FileList | null) {
    if (!list || !list.length) return;
    setReading(true);
    try {
      const f = await readLocalFolder(list);
      if (!f) return;
      setLocal(f);
      setScope({ kind: "local" });
      toast.success(`已选择「${f.name}」：${f.total} 个文件，读入 ${f.files.length} 个文本文件`);
    } catch {
      toast.error("读取文件夹失败");
    } finally {
      setReading(false);
      if (folderRef.current) folderRef.current.value = "";
    }
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    if (!picked || picked.disabled) {
      toast.error(picked?.reason || "请先选择一个可用的模型");
      return;
    }
    if (agentMode && scope.kind === "local") {
      toast.error("动手模式不能读本地文件夹，请把范围换成项目或工作区");
      return;
    }
    setInput("");
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: "user", content: q }]);
    setBusy(true);
    if (agentMode) {
      try {
        const res = await fetch("/api/ai/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: chatId || undefined, message: q, scope: scope.kind === "none" ? "workspace" : scope.kind, projectId: scope.projectId, credentialId: picked.credentialId, model: picked.model }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "暂时无法开始");
        setTasks((m) => ({ ...m, [data.task.id]: data.task }));
        setMessages((m) => [...m.filter((x) => !x.id.startsWith("tmp-")), data.userMessage, data.message]);
        setFreshIds((f) => new Set(f).add(data.message.id));
        if (!chatId) {
          setTitle(q.slice(0, 30));
          router.replace(`/ai?c=${data.conversationId}`, { scroll: false });
        }
        window.dispatchEvent(new Event(AI_CHATS_CHANGED));
      } catch (e) {
        setMessages((m) => [...m, { id: `err-${Date.now()}`, role: "assistant", content: e instanceof Error ? e.message : "网络异常", error: true }]);
      }
      setBusy(false);
      inputRef.current?.focus();
      return;
    }
    try {
      const res = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: chatId || undefined, message: q, scope: scope.kind, projectId: scope.projectId, credentialId: picked.credentialId, model: picked.model, localFiles: scope.kind === "local" && local ? { name: local.name, tree: local.tree, files: local.files } : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "暂时无法回答");
      setMessages((m) => [...m, data.message]);
      setFreshIds((f) => new Set(f).add(data.message.id));
      if (!chatId) {
        setTitle(q.slice(0, 30));
        router.replace(`/ai?c=${data.conversationId}`, { scroll: false });
      }
      window.dispatchEvent(new Event(AI_CHATS_CHANGED));
    } catch (e) {
      setMessages((m) => [...m, { id: `err-${Date.now()}`, role: "assistant", content: e instanceof Error ? e.message : "网络异常", error: true }]);
    }
    setBusy(false);
    inputRef.current?.focus();
  }

  async function resolve(m: Msg, ok: boolean) {
    const res = await fetch(`/api/ai/actions/${encodeURIComponent(m.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: ok }) });
    const data = await res.json().catch(() => ({}));
    const status = ok ? (res.ok ? "done" : "failed") : "cancelled";
    setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, actionStatus: status, actionResult: data.message || data.error || null } : x)));
    if (ok) (res.ok ? toast.success("已执行") : toast.error(data.error || data.message || "执行失败"));
    if (ok && res.ok) router.refresh();
  }

  async function removeChat() {
    if (!chatId) return;
    if (!(await confirm({ title: "删除这段对话？", body: "删除后不能恢复。", confirmLabel: "删除", tone: "danger" }))) return;
    await fetch(`/api/ai/conversations/${encodeURIComponent(chatId)}`, { method: "DELETE" });
    window.dispatchEvent(new Event(AI_CHATS_CHANGED));
    router.push("/ai");
  }

  const groups = [
    { key: "enterprise", label: "企业模型", items: (options || []).filter((o) => o.source === "enterprise") },
    { key: "personal", label: "我的模型", items: (options || []).filter((o) => o.source === "personal") },
  ].filter((g) => g.items.length);

  return (
    <div className="nv-ai">
      <WorkHeader
        crumbs={chatId ? [{ label: "AI 助手", href: "/ai", icon: "sparkles" }, { label: title || "对话" }] : [{ label: "AI 助手", icon: "sparkles" }]}
        actions={
          <>
            <span className={`nv-tag is-dot ${agentMode ? "is-accent" : "is-neutral"}`}>{agentMode ? "动手模式 · 写数据前先问你" : "新建、修改前会先请你确认"}</span>
            {chatId ? (
              <ActionMenu
                label="对话操作"
                items={[
                  { label: "新对话", onSelect: () => router.push("/ai") },
                  { label: "删除这段对话", tone: "danger", onSelect: () => void removeChat() },
                ]}
              />
            ) : null}
          </>
        }
      />

      <div ref={listRef} className="nv-ai-scroll" aria-live="polite">
        <div className="nv-ai-col">
          {options && options.length === 0 ? (
            <div className="banner-warning" role="status">
              还没有可用的模型。到 <Link href="/settings/models" className="text-link">设置 · 个人 · 模型管理</Link> 添加自己的模型，或请企业超管配置企业模型。
            </div>
          ) : null}
          {scope.kind === "local" ? (
            local ? (
              <div className="nv-ai-local" role="status">
                <FolderOpen size={16} aria-hidden="true" />
                <span>
                  本地文件夹「{local.name}」：共 {local.total} 个文件，读入 {local.files.length} 个文本文件。提问时会把这些内容发给所选模型，服务器不保存文件。
                </span>
              </div>
            ) : (
              <div className="banner-warning" role="status">
                这段对话关联的是本地文件夹。浏览器刷新后读不到原来的文件，请在下方「范围」里重新选择文件夹再继续。
              </div>
            )
          ) : null}
          {messages.length === 0 ? (
            <div className="nv-ai-empty">
              <XiaoweiAvatar state="idle" size={96} decorative />
              <p>可以问需求、Bug、发版的进展、逾期和负责人情况，也可以让我新建需求、Bug 或改状态（执行前会请你确认）。选「不关联数据」时就是普通对话。</p>
            </div>
          ) : null}
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="nv-ai-q">
                <p>{m.content}</p>
              </div>
            ) : (
              <div key={m.id} className={`nv-ai-a${m.error ? " is-error" : ""}`}>
                <XiaoweiAvatar state={avatarState(m, m.agentTaskId ? tasks[m.agentTaskId] : undefined, m.id === lastAnswerId && freshIds.has(m.id))} />
                <div className="nv-ai-a-body">
                  {m.agentTaskId && tasks[m.agentTaskId] ? (
                    <AgentRun
                      task={tasks[m.agentTaskId]}
                      projects={projects}
                      onResolve={(approve, note) => resolveTask(m.agentTaskId!, approve, note)}
                      onStop={() => stopTask(m.agentTaskId!)}
                    />
                  ) : null}
                  {m.content ? m.error ? <p className="nv-ai-text">{m.content}</p> : <Markdown text={m.content} className="nv-ai-text" /> : null}
                  {m.action ? (
                    <div className={`nv-ai-action is-${m.actionStatus || "pending"}`}>
                      <p>
                        <b>{ACTION_LABEL[String(m.action.type)] || "操作"}</b>：{actionText(m.action, projects)}
                      </p>
                      {m.actionStatus === "pending" ? (
                        <div className="nv-ai-action-btns">
                          <button type="button" className="btn-primary nv-head-btn" onClick={() => void resolve(m, true)}>
                            <Check size={14} aria-hidden="true" />
                            确认执行
                          </button>
                          <button type="button" className="btn-secondary nv-head-btn" onClick={() => void resolve(m, false)}>
                            <X size={14} aria-hidden="true" />
                            取消
                          </button>
                        </div>
                      ) : (
                        <p className="nv-ai-note">{m.actionStatus === "done" ? "已执行" : m.actionStatus === "cancelled" ? "已取消" : `未执行：${m.actionResult || "失败"}`}</p>
                      )}
                    </div>
                  ) : null}
                  {!m.error && m.content ? (
                    <div className="nv-ai-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="复制回答"
                        title="复制"
                        onClick={() => {
                          void navigator.clipboard?.writeText(m.content);
                          toast.success("已复制");
                        }}
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ),
          )}
          {busy ? (
            <p className="nv-ai-busy" role="status">
              <XiaoweiAvatar state="thinking" decorative /> 小围正在思考…
            </p>
          ) : null}
          {!busy && messages.length === 0 ? (
            <div className="nv-ai-suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <form
        className="nv-ai-input"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <div className="nv-ai-box">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            maxLength={4000}
            placeholder={agentMode ? "交代一件事，小围会自己查、自己做，写数据前先问你…" : "问问项目进展，或让我新建需求、Bug…"}
            aria-label="向 AI 助手提问"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(input);
              }
            }}
          />
          <div className="nv-ai-box-row">
            <div className="nv-prop-wrap">
              <button type="button" className="nv-prop is-set" aria-expanded={modelOpen} onClick={() => setModelOpen((v) => !v)}>
                <Cpu size={14} aria-hidden="true" />
                {picked ? picked.label : "选择模型"}
                <ChevronDown size={12} aria-hidden="true" />
              </button>
              {modelOpen ? (
                <div className="nv-prop-pop is-up nv-ai-model-pop" role="listbox">
                  {groups.map((g) => (
                    <div key={g.key}>
                      <p className="nv-ai-pop-group">{g.label}</p>
                      {g.items.map((o) => (
                        <button
                          key={`${o.credentialId}|${o.model}`}
                          type="button"
                          role="option"
                          aria-selected={`${o.credentialId}|${o.model}` === pick}
                          aria-disabled={o.disabled || undefined}
                          title={o.reason}
                          onClick={() => {
                            if (o.disabled) return toast.error(o.reason || "token 不足");
                            setPick(`${o.credentialId}|${o.model}`);
                            setModelOpen(false);
                          }}
                        >
                          {o.label}
                          {o.disabled ? <span className="nv-ai-note"> · token 不足</span> : null}
                        </button>
                      ))}
                    </div>
                  ))}
                  {quotaNote ? <p className="nv-ai-pop-group">{quotaNote}</p> : null}
                </div>
              ) : null}
            </div>
            <div className="nv-prop-wrap">
              <button type="button" className="nv-prop is-set" aria-expanded={scopeOpen} onClick={() => setScopeOpen((v) => !v)}>
                <Folder size={14} aria-hidden="true" />
                范围：{scopeName}
                <ChevronDown size={12} aria-hidden="true" />
              </button>
              {scopeOpen ? (
                <div className="nv-prop-pop is-up" role="listbox" style={{ width: 240 }}>
                  {[{ id: "__none", name: "不关联数据" }, { id: "__ws", name: "工作区（我能看到的全部项目）" }, ...projects].map((p) => {
                    const next: Scope = p.id === "__none" ? { kind: "none" } : p.id === "__ws" ? { kind: "workspace" } : { kind: "project", projectId: p.id };
                    const sel = next.kind === scope.kind && (next.kind !== "project" || next.projectId === scope.projectId);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="option"
                        aria-selected={sel}
                        onClick={() => {
                          setScope(next);
                          setScopeOpen(false);
                        }}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                  {local ? (
                    <button type="button" role="option" aria-selected={scope.kind === "local"} onClick={() => { setScope({ kind: "local" }); setScopeOpen(false); }}>
                      本地 · {local.name}
                    </button>
                  ) : null}
                  <div className="nv-menu-sep" role="separator" />
                  <button
                    type="button"
                    className="nv-ai-folder-btn"
                    onClick={() => {
                      setScopeOpen(false);
                      folderRef.current?.click();
                    }}
                  >
                    <FolderOpen size={14} aria-hidden="true" />
                    新建工作区：选择本地文件夹…
                  </button>
                </div>
              ) : null}
            </div>
            <button type="button" className={`nv-prop${agentMode ? " is-set nv-agent-chip" : ""}`} aria-pressed={agentMode} title="开启后小围会自己调用工具把事做完：读数据直接做，新建、修改先问你" onClick={toggleAgent}>
              <Hand size={14} aria-hidden="true" />
              动手模式：{agentMode ? "开" : "关"}
            </button>
            <input
              ref={folderRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              multiple
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(e) => void onFolder(e.target.files)}
            />
            <span className="nv-ai-hint">{reading ? "正在读取文件夹…" : "Enter 发送 · Shift+Enter 换行"}</span>
            <button type="submit" className="btn-primary nv-head-btn" disabled={!input.trim() || busy}>
              发送
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
