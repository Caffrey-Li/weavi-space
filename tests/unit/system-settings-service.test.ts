import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({
  prisma: { activityLog: { create: vi.fn(() => Promise.resolve()) } },
}));
vi.mock("@pm-collab/core/shared/system-settings", () => ({
  TIMEZONES: [{ value: "Asia/Shanghai", label: "上海" }],
  getSystemSettings: vi.fn(),
  saveSystemSettings: vi.fn(),
}));
vi.mock("@pm-collab/core/shared/svg-sanitize", () => ({ sanitizeSvg: vi.fn() }));
vi.mock("@pm-collab/core/shared/upload-guard", () => ({ sniffImage: vi.fn() }));

import { prisma } from "@pm-collab/db/prisma";
import { getSystemSettings, saveSystemSettings } from "@pm-collab/core/shared/system-settings";
import { PUT } from "@pm-collab/core/system/settings";

const admin = { id: "a", email: "a@example.test", name: "A", globalRole: "admin" };
const member = { id: "m", email: "m@example.test", name: "M", globalRole: "member" };

describe("PUT /api/system/settings 校验优先于 admin", () => {
  beforeEach(() => vi.resetAllMocks());

  it("空名称先 400，不检查角色、不读不写设置", async () => {
    const response = await PUT(member, { name: "  " });
    expect(response).toEqual({ body: { error: "请填写系统名称" }, init: { status: 400 } });
    expect(getSystemSettings).not.toHaveBeenCalled();
    expect(saveSystemSettings).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it("非法时区先 400，不写库", async () => {
    const response = await PUT(admin, { timezone: "Mars/Olympus" });
    expect(response).toEqual({ body: { error: "不支持的时区" }, init: { status: 400 } });
    expect(saveSystemSettings).not.toHaveBeenCalled();
  });

  it("非法 logo 类型先 400，不写库", async () => {
    const response = await PUT(admin, { logo: "data:image/gif;base64,AAAA" });
    expect(response).toEqual({ body: { error: "标志只支持 PNG、JPG、WebP 或 SVG" }, init: { status: 400 } });
    expect(saveSystemSettings).not.toHaveBeenCalled();
  });

  it("无更新字段先 400，不检查 admin 写路径", async () => {
    const response = await PUT(admin, {});
    expect(response).toEqual({ body: { error: "没有需要更新的内容" }, init: { status: 400 } });
    expect(saveSystemSettings).not.toHaveBeenCalled();
  });

  it("字段合法后非管理员才 403，仍不写库", async () => {
    const response = await PUT(member, { name: "Nova", timezone: "Asia/Shanghai" });
    expect(response).toEqual({ body: { error: "只有系统管理员可以修改系统设置" }, init: { status: 403 } });
    expect(getSystemSettings).not.toHaveBeenCalled();
    expect(saveSystemSettings).not.toHaveBeenCalled();
  });
});
