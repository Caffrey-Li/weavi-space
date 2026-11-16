import { beforeEach, describe, expect, it, vi } from "vitest";

/** 系统内 Agent（T27）：消息格式转换、工具调用解析、循环（读直接做、写挂起、确认 / 不同意后接着跑、上限） */

type Row = Record<string, unknown> & { id: string };
const db = vi.hoisted(() => ({ tasks: new Map<string, Row>(), steps: [] as Row[], messages: [] as Row[] }));
const match = (r: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "in" in (v as object) ? ((v as { in: unknown[] }).in).includes(r[k]) : r[k] === v));

vi.mock("@pm-collab/db/prisma", async () => {
  const { Prisma } = await import("@prisma/client");
  const nul = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === Prisma.DbNull ? null : v]));
  return {
    prisma: {
      agentTask: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.tasks.get(where.id) ?? null),
        findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => db.tasks.get(where.id)!),
        findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) => [...db.tasks.values()].filter((t) => match(t, where)).slice(0, take ?? 99)),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const t = { ...db.tasks.get(where.id)!, ...nul(data) };
          db.tasks.set(where.id, t);
          return t;
        }),
        updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          let count = 0;
          for (const t of db.tasks.values()) if (match(t, where)) { Object.assign(t, nul(data)); count++; }
          return { count };
        }),
      },
      agentStep: {
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => [...db.steps].reverse().find((s) => match(s, where)) ?? null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const s = { id: `s${db.steps.length + 1}`, ...data } as Row; db.steps.push(s); return s; }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(db.steps.find((s) => s.id === where.id)!, data)),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      aiMessage: { updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => { for (const m of db.messages) if (match(m, where)) Object.assign(m, data); return { count: 1 }; }) },
      user: { findUnique: vi.fn(async () => ({ id: "u1", email: "a@b", name: "王五", globalRole: "member", avatarUrl: null, isActive: true, isDemo: false })) },
      project: { findUnique: vi.fn(async () => ({ name: "演示项目" })) },
    },
  };
});
vi.mock("@pm-collab/core/ai/credentials", () => ({ credentialForUse: vi.fn(async () => ({ cred: { provider: "deepseek", apiKey: "k" }, billedTo: "user", enterpriseId: null, credentialId: "c1" })) }));
vi.mock("@pm-collab/core/ai/quota", () => ({ recordUsage: vi.fn(async () => undefined) }));
vi.mock("@pm-collab/core/ai/providers", async (original) => ({ ...(await original<typeof import("@pm-collab/core/ai/providers")>()), chatWithTools: vi.fn() }));

import { chatWithTools, toAnthropicMessages, toOpenAiMessages, type AgentMsg } from "@pm-collab/core/ai/providers";
import { MAX_STEPS, cancelTask, registerAgentDeps, resolvePending, startQueued, summarize, toolLevel, truncate } from "@pm-collab/core/agent/loop";

const exec = vi.fn();
const tools = [
  { name: "list_requirements", description: "查需求", parameters: { type: "object", properties: {} }, level: "read" as const, label: "查询需求" },
  { name: "create_requirement", description: "建需求", parameters: { type: "object", properties: {} }, level: "write" as const, label: "新建需求" },
];
const user = { id: "u1", email: "a@b", name: "王五", globalRole: "member" };
const llm = vi.mocked(chatWithTools);
const reply = (text: string, calls: { id: string; name: string; args?: Record<string, unknown> }[] = []) => ({ text, toolCalls: calls.map((c) => ({ args: {}, ...c })), inputTokens: 100, outputTokens: 20 });

function newTask(id = "t1") {
  db.tasks.set(id, { id, userId: "u1", status: "queued", goal: "整理需求", projectId: "p1", credentialId: "c1", model: "deepseek-chat", transcript: [{ role: "user", content: "整理需求" }], pending: null, steps: 0, maxSteps: MAX_STEPS, maxTokens: 200_000, hops: 0, source: "chat", inputTokens: 0, outputTokens: 0, createdAt: new Date() });
  db.messages.push({ id: `m-${id}`, agentTaskId: id, role: "assistant", content: "" });
}
async function settle() {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  db.tasks.clear();
  db.steps.length = 0;
  db.messages.length = 0;
  llm.mockReset();
  exec.mockReset();
  registerAgentDeps({ tools, exec });
});

describe("消息格式", () => {
  const msgs: AgentMsg[] = [
    { role: "user", content: "查一下" },
    { role: "assistant", content: "", toolCalls: [{ id: "a", name: "list_requirements", args: { projectId: "p1" } }, { id: "b", name: "list_bugs", args: {} }] },
    { role: "tool", toolCallId: "a", name: "list_requirements", content: "[]" },
    { role: "tool", toolCallId: "b", name: "list_bugs", content: "[]" },
  ];
  it("OpenAI 兼容：tool_calls 带 JSON 字符串参数，工具结果用 tool 角色", () => {
    const out = toOpenAiMessages("sys", msgs) as Record<string, unknown>[];
    expect(out[0]).toEqual({ role: "system", content: "sys" });
    expect((out[2].tool_calls as { function: { arguments: string } }[])[0].function.arguments).toBe('{"projectId":"p1"}');
    expect(out[3]).toEqual({ role: "tool", tool_call_id: "a", content: "[]" });
  });
  it("Anthropic：相邻的工具结果合并成一条 user 消息", () => {
    const out = toAnthropicMessages(msgs);
    expect(out).toHaveLength(3);
    expect(out[1].content.map((b) => (b as { type: string }).type)).toEqual(["tool_use", "tool_use"]);
    expect(out[2].content).toHaveLength(2);
  });
});

describe("工具等级和摘要", () => {
  it("list_ / get_ 是只读，其余是写", () => {
    expect(toolLevel("list_bugs")).toBe("read");
    expect(toolLevel("get_doc_page")).toBe("read");
    expect(toolLevel("create_bug")).toBe("write");
    expect(toolLevel("run_skill")).toBe("write");
  });
  it("摘要：列表给条数，详情给标题，失败给原因", () => {
    expect(summarize("x", true, { data: [], meta: { total: 38 } })).toBe("38 条");
    expect(summarize("x", true, { data: { title: "导出" } })).toBe("导出");
    expect(summarize("x", true, { data: { requirement: { id: "r1", title: "导出" } } })).toBe("导出");
    expect(summarize("x", false, { error: { message: "无权操作" } })).toBe("失败：无权操作");
    expect(truncate("a".repeat(20), 10)).toContain("已截断");
  });
});

describe("Agent 循环", () => {
  it("只读工具直接执行，没有工具调用时结束并写回答", async () => {
    newTask();
    llm.mockResolvedValueOnce(reply("我先查一下", [{ id: "c1", name: "list_requirements", args: { projectId: "p1" } }])).mockResolvedValueOnce(reply("一共 2 条需求"));
    exec.mockResolvedValue({ ok: true, data: { data: [{}, {}], meta: { total: 2 } } });
    await startQueued();
    await settle();
    const t = db.tasks.get("t1")!;
    expect(t.status).toBe("done");
    expect(t.result).toBe("一共 2 条需求");
    expect(t.steps).toBe(2);
    expect(exec).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), "list_requirements", { projectId: "p1" });
    expect(db.steps.map((s) => s.summary)).toEqual(["查询需求 · 2 条", "完成"]);
    expect(db.messages[0].content).toBe("一共 2 条需求");
    // 工具结果标明是资料
    expect(JSON.stringify(t.transcript)).toContain("仅供参考的资料");
  });

  it("写操作挂起等确认；确认后用本人权限执行，再接着跑", async () => {
    newTask();
    llm.mockResolvedValueOnce(reply("", [{ id: "w1", name: "create_requirement", args: { title: "导出" } }]));
    await startQueued();
    await settle();
    let t = db.tasks.get("t1")!;
    expect(t.status).toBe("waiting");
    expect((t.pending as { calls: { name: string }[] }).calls[0].name).toBe("create_requirement");
    expect(exec).not.toHaveBeenCalled();
    expect(llm).toHaveBeenCalledTimes(1); // 等确认期间不再调模型

    llm.mockResolvedValueOnce(reply("已新建"));
    exec.mockResolvedValue({ ok: true, data: { data: { title: "导出" } } });
    expect(await resolvePending("t1", user, true, "")).toBe(true);
    await settle();
    t = db.tasks.get("t1")!;
    expect(exec).toHaveBeenCalledWith(user, "create_requirement", { title: "导出" });
    expect(t.status).toBe("done");
    expect(db.steps.find((s) => s.kind === "confirm")!.status).toBe("approved");
    // 重复确认无效
    expect(await resolvePending("t1", user, true, "")).toBe(false);
  });

  it("不同意：不执行，把意见交给模型", async () => {
    newTask();
    llm.mockResolvedValueOnce(reply("", [{ id: "w1", name: "create_requirement", args: { title: "导出" } }])).mockResolvedValueOnce(reply("好的，不建了"));
    await startQueued();
    await settle();
    await resolvePending("t1", user, false, "标题要写清楚");
    await settle();
    const t = db.tasks.get("t1")!;
    expect(exec).not.toHaveBeenCalled();
    expect(JSON.stringify(t.transcript)).toContain("标题要写清楚");
    expect(t.status).toBe("done");
    expect(db.steps.find((s) => s.kind === "confirm")!.summary).toContain("你没有同意");
  });

  it("同一轮里写操作之后的调用，确认后继续处理（遇到下一个写再挂起）", async () => {
    newTask();
    llm.mockResolvedValueOnce(reply("", [{ id: "w1", name: "create_requirement", args: { title: "A" } }, { id: "w2", name: "create_requirement", args: { title: "B" } }]));
    exec.mockResolvedValue({ ok: true, data: {} });
    await startQueued();
    await settle();
    await resolvePending("t1", user, true, "");
    await settle();
    const t = db.tasks.get("t1")!;
    expect(t.status).toBe("waiting");
    expect((t.pending as { calls: { args: { title: string } }[] }).calls[0].args.title).toBe("B");
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("没有的工具返回错误给模型；到步数上限就停", async () => {
    newTask();
    llm.mockResolvedValue(reply("", [{ id: "x", name: "drop_database" }]));
    await startQueued();
    await settle();
    await settle();
    const t = db.tasks.get("t1")!;
    expect(t.status).toBe("failed");
    expect(t.steps).toBe(MAX_STEPS);
    expect(db.steps.at(-1)!.summary).toContain("上限");
  });

  it("停止：等确认的任务可以停止", async () => {
    newTask();
    llm.mockResolvedValueOnce(reply("", [{ id: "w1", name: "create_requirement", args: { title: "A" } }]));
    await startQueued();
    await settle();
    expect(await cancelTask("t1", "u1")).toBe(true);
    expect(db.tasks.get("t1")!.status).toBe("cancelled");
    expect(await resolvePending("t1", user, true, "")).toBe(false);
  });
});
