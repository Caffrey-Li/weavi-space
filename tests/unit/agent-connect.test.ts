import { beforeEach, describe, expect, it, vi } from "vitest";

/** 本机 Agent 接入（T28）：配置写法、地址规整、连接状态、连通测试 */
const db = vi.hoisted(() => ({ conn: null as Record<string, unknown> | null, updates: [] as Record<string, unknown>[] }));
vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    agentConnection: {
      findUnique: vi.fn(async ({ where }: { where: { tokenId: string } }) => (db.conn && db.conn.tokenId === where.tokenId ? db.conn : null)),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { db.updates.push(data); Object.assign(db.conn!, data); return db.conn; }),
    },
  },
}));

import { AGENT_PRESETS, connState, mcpUrlOf, normalizeBaseUrl, presetOf, testPrompt } from "@pm-collab/core/shared/agent-clients";
import { passTest } from "@pm-collab/core/agent-connect/service";

beforeEach(() => {
  db.conn = { id: "c1", tokenId: "tok1", name: "Cursor · 我的电脑", testCode: "7K3Q9P", testExpiresAt: new Date(Date.now() + 60_000) };
  db.updates = [];
});

describe("配置写法", () => {
  const url = mcpUrlOf("http://192.0.2.10:3100");
  it("每个预设都能生成配置，里面有地址和令牌", () => {
    for (const p of AGENT_PRESETS) {
      const out = p.build(url, "nc_pat_x");
      expect(out, p.key).toContain(url);
      expect(out, p.key).toContain("nc_pat_x");
      if (p.lang === "json") expect(() => JSON.parse(out), p.key).not.toThrow();
    }
  });
  it("各家字段名不同", () => {
    expect(JSON.parse(presetOf("cursor")!.build(url, "t")).mcpServers["weavi-space"].url).toBe(url);
    expect(JSON.parse(presetOf("antigravity")!.build(url, "t")).mcpServers["weavi-space"].serverUrl).toBe(url);
    expect(JSON.parse(presetOf("gemini_cli")!.build(url, "t")).mcpServers["weavi-space"].httpUrl).toBe(url);
    expect(presetOf("claude_code")!.build(url, "t")).toBe(`claude mcp add --transport http weavi-space ${url} --header "Authorization: Bearer t"`);
    expect(presetOf("codex")!.build(url, "t")).toContain('"mcp-remote"');
  });
  it("系统地址只留协议、主机和端口", () => {
    expect(normalizeBaseUrl("http://192.0.2.10:3100/ai?x=1")).toBe("http://192.0.2.10:3100");
    expect(normalizeBaseUrl("ftp://a")).toBeNull();
    expect(normalizeBaseUrl("http://u:p@a.com")).toBeNull();
    expect(normalizeBaseUrl("不是地址")).toBeNull();
    expect(testPrompt("ABC123")).toContain("weavi_connection_test");
  });
});

describe("连接状态", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  const base = { verifiedAt: null, lastTestAt: null, testCode: null, testExpiresAt: null };
  it("令牌失效优先；测试码有效时是测试中；测试后没收到调用是连不上", () => {
    expect(connState(base, false, now)).toBe("token_invalid");
    expect(connState(base, true, now)).toBe("untested");
    expect(connState({ ...base, testCode: "X", testExpiresAt: new Date(now.getTime() + 1000), lastTestAt: now }, true, now)).toBe("testing");
    expect(connState({ ...base, testCode: "X", testExpiresAt: new Date(now.getTime() - 1000), lastTestAt: new Date(now.getTime() - 900_000) }, true, now)).toBe("failed");
    expect(connState({ ...base, lastTestAt: new Date(now.getTime() - 5000), verifiedAt: new Date(now.getTime() - 1000) }, true, now)).toBe("verified");
    // 测过通了，后来又测一次没通
    expect(connState({ ...base, verifiedAt: new Date(now.getTime() - 9000), lastTestAt: new Date(now.getTime() - 1000) }, true, now)).toBe("failed");
  });
});

describe("连通测试工具", () => {
  const read = vi.fn(async () => ({ ok: true, count: 3 }));
  it("测试码对、没过期：通过，记下读取结果，测试码作废", async () => {
    const r = await passTest("tok1", "7k3q9p", read);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("能看到 3 个项目");
    expect(db.conn!.testCode).toBeNull();
    expect(db.conn!.verifiedAt).toBeInstanceOf(Date);
    // 同一个码不能再用
    expect((await passTest("tok1", "7K3Q9P", read)).ok).toBe(false);
  });
  it("测试码不对、过期、别的令牌：都不通过", async () => {
    expect((await passTest("tok1", "AAAAAA", read)).ok).toBe(false);
    expect((await passTest("other", "7K3Q9P", read)).ok).toBe(false);
    db.conn!.testExpiresAt = new Date(Date.now() - 1000);
    expect((await passTest("tok1", "7K3Q9P", read)).message).toContain("过期");
    expect(db.updates).toHaveLength(0);
  });
  it("连上了但读不到：仍算连通，提示检查权限", async () => {
    const r = await passTest("tok1", "7K3Q9P", async () => ({ ok: false, count: 0 }));
    expect(r.ok).toBe(true);
    expect(db.conn!.testDetail).toContain("读取项目失败");
  });
});
