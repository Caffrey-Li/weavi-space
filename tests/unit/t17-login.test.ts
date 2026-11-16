import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    userIdentity: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn() },
    loginProvider: { findUnique: vi.fn(), upsert: vi.fn() },
    organization: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));
vi.mock("@pm-collab/core/shared/org", async (original) => ({ ...(await original<typeof import("@pm-collab/core/shared/org")>()), listOrgs: vi.fn() }));
vi.mock("@pm-collab/core/shared/secure-config", async (original) => ({
  ...(await original<typeof import("@pm-collab/core/shared/secure-config")>()),
  getStoredFeishu: vi.fn(async () => null),
}));

import { prisma } from "@pm-collab/db/prisma";
import { listOrgs } from "@pm-collab/core/shared/org";
import { maskPhone, normalizePhone, phoneHash } from "@pm-collab/core/login/phone";
import { aliyunSignedUrl } from "@pm-collab/core/login/channels";
import { SsoError, resolveSsoUser } from "@pm-collab/core/login/sso";
import { complete, saveProvider } from "@pm-collab/core/login/providers";
import { sealText } from "@pm-collab/core/shared/secure-config";

const ORGS = [
  { id: "org_nova_collab", name: "Nova", type: "system", parentId: null, sortOrder: 0 },
  { id: "ent-a", name: "甲", type: "enterprise", parentId: "org_nova_collab", sortOrder: 0 },
  { id: "dept-a", name: "甲研发", type: "department", parentId: "ent-a", sortOrder: 0 },
  { id: "ent-b", name: "乙", type: "enterprise", parentId: "org_nova_collab", sortOrder: 1 },
];
const userA = { id: "ua", email: "a@jia.test", orgId: "dept-a", isActive: true, phoneHash: null };
const userB = { id: "ub", email: "b@yi.test", orgId: "ent-b", isActive: true, phoneHash: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listOrgs).mockResolvedValue(ORGS);
});

describe("手机号", () => {
  it.each([
    ["138 0013 8000", "13800138000"],
    ["+86 138-0013-8000", "13800138000"],
    ["8613800138000", "13800138000"],
    ["+85291234567", "+85291234567"],
  ])("规范化 %s", (raw, want) => expect(normalizePhone(raw)).toBe(want));
  it.each([["12345"], ["abc"], [""], ["2380013800"]])("非法 %s", (raw) => expect(normalizePhone(raw)).toBeNull());
  it("脱敏只露前 3 后 4，哈希稳定且不含原号码", () => {
    expect(maskPhone("13800138000")).toBe("138****8000");
    expect(phoneHash("13800138000")).toBe(phoneHash("13800138000"));
    expect(phoneHash("13800138000")).not.toContain("13800138000");
  });
});

describe("阿里云短信签名", () => {
  it("按 RPC 规则排序编码并签名（与官方示例一致）", () => {
    // 阿里云文档 SignatureVersion 1.0 的示例参数与 testSecret 密钥
    const url = aliyunSignedUrl(
      {
        AccessKeyId: "testId",
        Action: "SendSms",
        Format: "XML",
        OutId: "123",
        PhoneNumbers: "15300000001",
        RegionId: "cn-hangzhou",
        SignName: "阿里云短信测试专用",
        SignatureMethod: "HMAC-SHA1",
        SignatureNonce: "45e25e9b-0a6f-4070-8c85-2956eda1b466",
        SignatureVersion: "1.0",
        TemplateCode: "SMS_71390007",
        TemplateParam: '{"customer":"test"}',
        Timestamp: "2017-07-12T02:42:19Z",
        Version: "2017-05-25",
      },
      "testSecret",
    );
    expect(url.startsWith("https://dysmsapi.aliyuncs.com/?Signature=zJDF%2BLrzhj%2FThnlvIToysFRq6t4%3D&")).toBe(true);
  });
});

describe("扫码登录找账号", () => {
  it("已绑定的身份直接登录", async () => {
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue({ user: userA } as never);
    expect((await resolveSsoUser("wecom", "ent-a", { externalId: "zhang" })).id).toBe("ua");
    expect(prisma.userIdentity.create).not.toHaveBeenCalled();
  });
  it("没有绑定也没有邀请：拒绝，不自动开通", async () => {
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(null);
    await expect(resolveSsoUser("wecom", "ent-a", { externalId: "zhang" })).rejects.toMatchObject({ reason: "not_member" });
  });
  it("凭邀请链接绑定到被邀请的账号", async () => {
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(userA as never);
    vi.mocked(prisma.userIdentity.findFirst).mockResolvedValue(null);
    expect((await resolveSsoUser("dingtalk", "ent-a", { externalId: "union1" }, "ua")).id).toBe("ua");
    expect(prisma.userIdentity.create).toHaveBeenCalledWith({ data: { userId: "ua", provider: "dingtalk", scope: "ent-a", externalId: "union1" } });
  });
  it("别的企业的账号不能用本企业的应用登录（即使邮箱一致）", async () => {
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "ub" }] as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(userB as never);
    await expect(resolveSsoUser("feishu", "ent-a", { externalId: "ou_1", email: "b@yi.test" })).rejects.toBeInstanceOf(SsoError);
    expect(prisma.userIdentity.create).not.toHaveBeenCalled();
  });
  it("本企业飞书返回的企业邮箱一致时自动绑定", async () => {
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "ua" }] as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(userA as never);
    vi.mocked(prisma.userIdentity.findFirst).mockResolvedValue(null);
    expect((await resolveSsoUser("feishu", "ent-a", { externalId: "ou_1", email: "A@jia.test" })).id).toBe("ua");
  });
  it("已绑定其他第三方账号时拒绝换绑", async () => {
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(userA as never);
    vi.mocked(prisma.userIdentity.findFirst).mockResolvedValue({ externalId: "other" } as never);
    await expect(resolveSsoUser("wecom", "ent-a", { externalId: "zhang" }, "ua")).rejects.toMatchObject({ reason: "conflict" });
  });
  it("停用账号不能登录", async () => {
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue({ user: { ...userA, isActive: false } } as never);
    await expect(resolveSsoUser("wecom", "ent-a", { externalId: "zhang" })).rejects.toMatchObject({ reason: "inactive" });
  });
});

describe("登录方式配置", () => {
  it("配置不完整不能开启", async () => {
    vi.mocked(prisma.loginProvider.findUnique).mockResolvedValue(null);
    expect(await saveProvider("ent-a", "wecom", { enabled: true, config: { corpId: "ww1" } }, "u")).toEqual({ error: "请先把「企业微信」的配置填完整" });
    expect(prisma.loginProvider.upsert).not.toHaveBeenCalled();
  });
  it("企业开邮箱验证码要求系统级发送通道已配好", async () => {
    vi.mocked(prisma.loginProvider.findUnique).mockResolvedValue(null);
    expect(await saveProvider("ent-a", "email", { enabled: true }, "u")).toEqual({ error: "系统超管还没有配置邮件（SMTP）发送通道" });
  });
  it("密钥留空沿用旧值，存库的是密文", async () => {
    vi.mocked(prisma.loginProvider.findUnique).mockResolvedValue({ enabled: false, configEnc: sealText(JSON.stringify({ clientId: "ck", clientSecret: "old-secret" })) } as never);
    expect(await saveProvider("ent-a", "dingtalk", { enabled: true, config: { clientId: "ck2", clientSecret: "" } }, "u")).toEqual({ ok: true });
    const arg = vi.mocked(prisma.loginProvider.upsert).mock.calls[0][0] as { update: { configEnc: string } };
    expect(arg.update.configEnc).not.toContain("old-secret");
    expect(complete("dingtalk", { clientId: "ck2", clientSecret: "old-secret" })).toBe(true);
  });
});
