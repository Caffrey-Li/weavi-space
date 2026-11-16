import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/core/shared/secure-config", () => ({
  clearImageAi: vi.fn(),
  getStoredImageAi: vi.fn(),
  mask: vi.fn(),
  saveImageAi: vi.fn(),
}));

// 范围判断不查库：管理员 = 系统级 + 企业列表；其他人没有可管理的企业
vi.mock("@pm-collab/core/ai/credentials", () => ({
  managedEnterprise: vi.fn(async (s: { globalRole: string }) => ({ list: s.globalRole === "admin" ? [] : [], current: null })),
}));
vi.mock("@pm-collab/core/ai/image", () => ({ imageConfig: vi.fn(), imageUsage: vi.fn(async () => []), saveImageConfig: vi.fn(), clearImageConfig: vi.fn() }));
import { getStoredImageAi, saveImageAi } from "@pm-collab/core/shared/secure-config";
import { PUT } from "@pm-collab/core/system/ai-image";

const admin = { id: "a", email: "a@example.test", name: "A", globalRole: "admin" };
const member = { id: "m", email: "m@example.test", name: "M", globalRole: "member" };

describe("AI 生图 PUT 顺序", () => {
  beforeEach(() => vi.resetAllMocks());

  it("非管理员先 403，不校验地址/不保存", async () => {
    const response = await PUT(member, { baseUrl: "not-a-url", model: "" });
    expect(response).toEqual({ body: { error: "只能配置自己企业的 AI 生图" }, init: { status: 403 } });
    expect(getStoredImageAi).not.toHaveBeenCalled();
    expect(saveImageAi).not.toHaveBeenCalled();
  });

  it("管理员非法 https 地址先 400，不保存", async () => {
    const response = await PUT(admin, { baseUrl: "http://insecure.example", model: "m" });
    expect(response).toEqual({ body: { error: "服务地址需要是 https:// 开头的完整地址" }, init: { status: 400 } });
    expect(saveImageAi).not.toHaveBeenCalled();
  });
});
