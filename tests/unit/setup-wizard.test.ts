import { beforeEach, describe, expect, it, vi } from "vitest";

/** 首次安装向导：安装码生成 / 校验 / 过期、创建第一个超管（校验、并发、已有管理员）、第 3 步权限 */
const db = vi.hoisted(() => ({ admins: 0, settings: new Map<string, string>(), users: [] as { id: string; email: string; globalRole: string }[] }));
vi.mock("@pm-collab/db/prisma", () => {
  const prisma: Record<string, unknown> = {
    user: {
      count: vi.fn(async () => db.admins),
      findFirst: vi.fn(async ({ where }: { where: { email: { equals: string } } }) => db.users.find((u) => u.email === where.email.equals) ?? null),
      create: vi.fn(async ({ data }: { data: { email: string; globalRole: string } }) => {
        const u = { id: `u${db.users.length + 1}`, email: data.email, globalRole: data.globalRole };
        db.users.push(u);
        db.admins += 1;
        return { id: u.id };
      }),
    },
    systemSetting: {
      upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: { value: string } }) => db.settings.set(where.key, create.value)),
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (db.settings.has(where.key) ? { key: where.key, value: db.settings.get(where.key)! } : null)),
      deleteMany: vi.fn(async ({ where }: { where: { key: string } }) => db.settings.delete(where.key)),
    },
    activityLog: { create: vi.fn(async () => ({})) },
    $executeRaw: vi.fn(async () => 0),
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return { prisma };
});
vi.mock("@pm-collab/core/auth", () => ({ hashPassword: vi.fn(async (p: string) => `hash:${p}`) }));
vi.mock("@pm-collab/core/shared/org", () => ({ ensureSystemOrg: vi.fn(async () => undefined) }));
vi.mock("@pm-collab/core/shared/system-settings", () => ({ saveSystemSettings: vi.fn(async () => undefined) }));
vi.mock("@pm-collab/core/nova/enterprises", () => ({ POST: vi.fn(async (_s: unknown, b: { name: string; code: string }) => ({ body: { enterprise: { id: "e1", name: b.name, code: b.code } } })) }));

import { checkSetupCode, createFirstAdmin, generateCode, issueSetupCode, needsSetup, normalizeCode, resetSetupStateForTest, saveBasics } from "@pm-collab/core/setup/service";

const good = { name: "王小围", email: "Owner@Example.com", password: "Weavi2026space" };

beforeEach(() => {
  db.admins = 0;
  db.settings.clear();
  db.users = [];
  resetSetupStateForTest();
});

describe("安装码", () => {
  it("8 位、不含易混字符，输入时忽略大小写和横线", () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^[2-9A-HJ-KMNP-Z]{4}-[2-9A-HJ-KMNP-Z]{4}$/);
    expect(normalizeCode(" k7q2-9mxa ")).toBe("K7Q29MXA");
  });
  it("没有管理员时生成并打印，只存哈希；有管理员时不生成并清掉旧的", async () => {
    const lines: string[] = [];
    const code = await issueSetupCode((m) => lines.push(m));
    expect(code).toBeTruthy();
    expect(lines[0]).toContain(code!);
    expect(db.settings.get("setup_code")).not.toContain(code!.replace("-", ""));
    expect(await checkSetupCode(code!.toLowerCase())).toBe(true);
    expect(await checkSetupCode("AAAA-AAAA")).toBe(false);
    db.admins = 1;
    resetSetupStateForTest();
    expect(await issueSetupCode(() => undefined)).toBeNull();
    expect(db.settings.has("setup_code")).toBe(false);
  });
  it("过期作废", async () => {
    const code = (await issueSetupCode(() => undefined))!;
    const saved = JSON.parse(db.settings.get("setup_code")!);
    db.settings.set("setup_code", JSON.stringify({ ...saved, expiresAt: Date.now() - 1 }));
    expect(await checkSetupCode(code)).toBe(false);
  });
});

describe("创建第一个超管", () => {
  it("校验姓名、邮箱、密码和安装码", async () => {
    const code = (await issueSetupCode(() => undefined))!;
    expect(await createFirstAdmin({ ...good, code, name: "" })).toMatchObject({ status: 400 });
    expect(await createFirstAdmin({ ...good, code, email: "bad" })).toMatchObject({ status: 400 });
    expect(await createFirstAdmin({ ...good, code, password: "short1" })).toMatchObject({ status: 400 });
    expect(await createFirstAdmin({ ...good, code: "AAAA-AAAA" })).toMatchObject({ status: 403 });
    expect(db.users).toHaveLength(0);
  });
  it("成功后安装码作废、向导关闭，再建返回 404", async () => {
    const code = (await issueSetupCode(() => undefined))!;
    const r = await createFirstAdmin({ ...good, code });
    expect(r).toMatchObject({ userId: "u1" });
    expect(db.users[0]).toMatchObject({ email: "owner@example.com", globalRole: "admin" });
    expect(db.settings.has("setup_code")).toBe(false);
    expect(await needsSetup()).toBe(false);
    expect(await createFirstAdmin({ ...good, code, email: "b@example.com" })).toMatchObject({ status: 404 });
  });
  it("已经有管理员时不能用向导", async () => {
    const code = (await issueSetupCode(() => undefined))!;
    db.admins = 1;
    resetSetupStateForTest();
    expect(await createFirstAdmin({ ...good, code })).toMatchObject({ status: 404 });
  });
});

describe("第 3 步", () => {
  it("只有系统超管能保存；企业名称和编码一起建", async () => {
    expect(await saveBasics({ id: "u2", globalRole: "member" } as never, { systemName: "X" })).toMatchObject({ status: 403 });
    expect(await saveBasics({ id: "u1", globalRole: "admin" } as never, { systemName: "示例协同", enterpriseName: "示例科技", enterpriseCode: "demo" })).toMatchObject({ ok: true, enterprise: { name: "示例科技", code: "demo" } });
    expect(await saveBasics({ id: "u1", globalRole: "admin" } as never, { systemName: "x".repeat(31) })).toMatchObject({ status: 400 });
  });
});
