import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    aiCredential: { findUnique: vi.fn(), findMany: vi.fn() },
    aiQuota: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    aiUsage: { aggregate: vi.fn() },
    user: { findUnique: vi.fn() },
    organization: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    enterpriseSetting: { findUnique: vi.fn() },
    systemSetting: { findUnique: vi.fn() },
  },
}));
vi.mock("@pm-collab/core/shared/org", async (original) => ({ ...(await original<typeof import("@pm-collab/core/shared/org")>()), listOrgs: vi.fn() }));
vi.mock("@pm-collab/core/shared/secure-config", async (original) => ({ ...(await original<typeof import("@pm-collab/core/shared/secure-config")>()), getStoredImageAi: vi.fn() }));

import { prisma } from "@pm-collab/db/prisma";
import { listOrgs } from "@pm-collab/core/shared/org";
import { getStoredImageAi, sealText } from "@pm-collab/core/shared/secure-config";
import { parseAction } from "@pm-collab/core/ai/chat";
import { periodStart } from "@pm-collab/core/ai/quota";
import { availableModels, credentialForUse, setQuota } from "@pm-collab/core/ai/credentials";
import { imageConfig } from "@pm-collab/core/ai/image";

const ORGS = [
  { id: "org_nova_collab", name: "Nova", type: "system", parentId: null, sortOrder: 0 },
  { id: "ent-a", name: "甲", type: "enterprise", parentId: "org_nova_collab", sortOrder: 0 },
  { id: "ent-b", name: "乙", type: "enterprise", parentId: "org_nova_collab", sortOrder: 1 },
];
const me = { id: "u1", email: "u1@x.test", name: "U1", globalRole: "member" };
const entCred = { id: "c-ent", ownerType: "enterprise", ownerId: "ent-a", provider: "openai", name: "企业", baseUrl: null, apiKeyEnc: sealText("sk-ent"), models: ["gpt-x"], enabled: true };
const myCred = { id: "c-me", ownerType: "user", ownerId: "u1", provider: "deepseek", name: "我的", baseUrl: null, apiKeyEnc: sealText("sk-me"), models: ["deepseek-chat"], enabled: true };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listOrgs).mockResolvedValue(ORGS);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ orgId: "ent-a" } as never);
});

describe("AI 回复里的操作", () => {
  it("解析 action 代码块并从正文去掉", () => {
    const r = parseAction('好的，我来建。\n```action\n{"type":"create_requirement","projectId":"p1","title":"登录页"}\n```');
    expect(r.clean).toBe("好的，我来建。");
    expect(r.action).toEqual({ type: "create_requirement", projectId: "p1", title: "登录页" });
  });
  it("不认识的操作和坏 JSON 都忽略", () => {
    expect(parseAction('```action\n{"type":"delete_everything"}\n```').action).toBeNull();
    expect(parseAction("```action\n{oops\n```").action).toBeNull();
  });
});

describe("定额周期", () => {
  it("周从周一算起，月从 1 日算起", () => {
    const wed = new Date(2026, 10, 11, 15, 0); // 2026-11-11 周三
    expect(periodStart("week", wed).getDate()).toBe(9);
    expect(periodStart("month", wed).getDate()).toBe(1);
    expect(periodStart("day", wed).getHours()).toBe(0);
  });
});

describe("可选模型与额度", () => {
  it("企业模型排在前面；额度用完时企业模型不可选，个人模型照常", async () => {
    vi.mocked(prisma.aiCredential.findMany).mockImplementation((async (a: { where: { ownerType: string } }) => (a.where.ownerType === "enterprise" ? [entCred] : [myCred])) as never);
    vi.mocked(prisma.aiQuota.findMany).mockResolvedValue([{ userId: "", period: "month", tokenLimit: 100 }] as never);
    vi.mocked(prisma.aiUsage.aggregate).mockResolvedValue({ _sum: { inputTokens: 80, outputTokens: 30 } } as never);
    const { options } = await availableModels(me);
    expect(options.map((o) => o.source)).toEqual(["enterprise", "personal"]);
    expect(options[0]).toMatchObject({ disabled: true });
    expect(options[0].reason).toContain("已用完");
    expect(options[1].disabled).toBe(false);
  });
  it("调用前再查一次：额度用完拒绝企业模型", async () => {
    vi.mocked(prisma.aiCredential.findUnique).mockResolvedValue(entCred as never);
    vi.mocked(prisma.aiQuota.findMany).mockResolvedValue([{ userId: "u1", period: "day", tokenLimit: 10 }] as never);
    vi.mocked(prisma.aiUsage.aggregate).mockResolvedValue({ _sum: { inputTokens: 10, outputTokens: 0 } } as never);
    expect(await credentialForUse(me, "c-ent", "gpt-x")).toMatchObject({ error: expect.stringContaining("token 不足") });
  });
  it("别人的个人模型、别的企业的模型都不能用", async () => {
    vi.mocked(prisma.aiCredential.findUnique).mockResolvedValue({ ...myCred, ownerId: "u2" } as never);
    expect(await credentialForUse(me, "c-me", "deepseek-chat")).toHaveProperty("error");
    vi.mocked(prisma.aiCredential.findUnique).mockResolvedValue({ ...entCred, ownerId: "ent-b" } as never);
    expect(await credentialForUse(me, "c-ent", "gpt-x")).toHaveProperty("error");
  });
  it("没勾选的模型不能用", async () => {
    vi.mocked(prisma.aiCredential.findUnique).mockResolvedValue(myCred as never);
    expect(await credentialForUse(me, "c-me", "other-model")).toHaveProperty("error");
  });
  it("自己的模型可用，Key 解密后只在服务端", async () => {
    vi.mocked(prisma.aiCredential.findUnique).mockResolvedValue(myCred as never);
    expect(await credentialForUse(me, "c-me", "deepseek-chat")).toMatchObject({ billedTo: "user", cred: { apiKey: "sk-me" } });
  });
});

describe("定额设置权限", () => {
  it("普通成员不能设定额", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(null);
    expect((await setQuota(me, { enterpriseId: "ent-a", period: "month", tokenLimit: 100 })).init?.status).toBe(403);
    expect(prisma.aiQuota.upsert).not.toHaveBeenCalled();
  });
});

describe("AI 生图按企业隔离", () => {
  it("企业没配置时不借用系统级配置", async () => {
    vi.mocked(getStoredImageAi).mockResolvedValue({ baseUrl: "https://x", model: "m", apiKey: "sys" } as never);
    vi.mocked(prisma.enterpriseSetting.findUnique).mockResolvedValue(null);
    expect(await imageConfig("ent-a")).toBeNull();
    expect(await imageConfig("")).toMatchObject({ apiKey: "sys" });
  });
  it("企业配置解密后可用，带单价", async () => {
    vi.mocked(prisma.enterpriseSetting.findUnique).mockResolvedValue({ valueEnc: sealText(JSON.stringify({ baseUrl: "https://ark", model: "seedream", apiKey: "ent-key", priceCents: 25 })), updatedAt: new Date() } as never);
    expect(await imageConfig("ent-a")).toMatchObject({ apiKey: "ent-key", priceCents: 25 });
  });
});

describe("模型接口地址", () => {
  it.each([["http://127.0.0.1:8080/v1"], ["https://localhost/v1"], ["https://10.0.0.5/v1"], ["https://192.168.1.2/v1"], ["https://172.20.0.1/v1"], ["https://[::1]/v1"], ["https://metadata.internal/v1"], ["http://api.example.com/v1"]])("拒绝 %s", async (u) => {
    const { checkBaseUrl } = await import("@pm-collab/core/ai/providers");
    expect(() => checkBaseUrl(u)).toThrow();
  });
  it("公网 https 可以", async () => {
    const { checkBaseUrl } = await import("@pm-collab/core/ai/providers");
    expect(checkBaseUrl("https://api.deepseek.com/v1")).toBe("https://api.deepseek.com/v1");
  });
});
