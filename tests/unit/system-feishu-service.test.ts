import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/core/shared/feishu-auth", () => ({
  feishuRedirectUri: vi.fn(() => "https://example.test/api/auth/feishu/callback"),
  feishuSettings: vi.fn(),
}));
vi.mock("@pm-collab/core/shared/secure-config", () => ({
  clearFeishu: vi.fn(),
  getStoredFeishu: vi.fn(),
  mask: vi.fn((v: string | null | undefined) => (v ? `${v.slice(0, 4)}***` : "")),
  saveFeishu: vi.fn(),
}));

import { feishuSettings } from "@pm-collab/core/shared/feishu-auth";
import { clearFeishu, getStoredFeishu, saveFeishu } from "@pm-collab/core/shared/secure-config";
import { GET, PUT, DELETE } from "@pm-collab/core/system/feishu";

const req = new Request("https://example.test/api/system/feishu");
const admin = { id: "a", email: "a@example.test", name: "A", globalRole: "admin" };
const member = { id: "m", email: "m@example.test", name: "M", globalRole: "member" };

describe("GET /api/system/feishu 未登录也是 403", () => {
  beforeEach(() => vi.resetAllMocks());

  it("session 为 null 返回 403，不读取配置", async () => {
    const response = await GET(null, req);
    expect(response).toEqual({ body: { error: "仅系统管理员可查看" }, init: { status: 403 } });
    expect(getStoredFeishu).not.toHaveBeenCalled();
    expect(feishuSettings).not.toHaveBeenCalled();
  });

  it("非管理员返回 403，不读取配置", async () => {
    const response = await GET(member, req);
    expect(response).toEqual({ body: { error: "仅系统管理员可查看" }, init: { status: 403 } });
    expect(getStoredFeishu).not.toHaveBeenCalled();
  });
});

describe("PUT/DELETE /api/system/feishu 管理员门禁", () => {
  beforeEach(() => vi.resetAllMocks());

  it("未登录 PUT 403，不校验/不保存", async () => {
    const response = await PUT(null, req, { appId: "cli_x", appSecret: "s" });
    expect(response).toEqual({ body: { error: "仅系统管理员可修改" }, init: { status: 403 } });
    expect(saveFeishu).not.toHaveBeenCalled();
    expect(getStoredFeishu).not.toHaveBeenCalled();
  });

  it("未登录 DELETE 403，不清空", async () => {
    const response = await DELETE(null, req);
    expect(response).toEqual({ body: { error: "仅系统管理员可修改" }, init: { status: 403 } });
    expect(clearFeishu).not.toHaveBeenCalled();
  });

  it("管理员非法 App ID 先 400，不调用飞书校验保存", async () => {
    vi.mocked(getStoredFeishu).mockResolvedValue(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await PUT(admin, req, { appId: "bad", appSecret: "secret" });
    expect(response).toEqual({ body: { error: "App ID 格式不对，应以 cli_ 开头" }, init: { status: 400 } });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saveFeishu).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
