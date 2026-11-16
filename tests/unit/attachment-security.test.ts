import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/core/auth", () => ({ getSession: vi.fn() }));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: { attachment: { findUnique: vi.fn(), create: vi.fn() } } }));
vi.mock("@pm-collab/core/shared/attachments", () => ({ canReadAttachment: vi.fn() }));

import { getSession } from "@pm-collab/core/auth";
import { prisma } from "@pm-collab/db/prisma";
import { canReadAttachment } from "@pm-collab/core/shared/attachments";
import { GET } from "@/app/api/attachments/[id]/route";
import { POST } from "@/app/api/attachments/route";

const session = { id: "u", email: "u@example.test", name: "U", globalRole: "member" };
const params = { params: Promise.resolve({ id: "att" }) };
const attachment = { id: "att", data: Buffer.from("private"), mime: "text/plain", name: "test.txt", uploaderId: "other", ownerType: "requirement", ownerId: "r" };

describe("附件读取权限和上传限制", () => {
  beforeEach(() => vi.resetAllMocks());
  it("未登录不查询附件", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const response = await GET(new Request("http://localhost"), params);
    expect(response.status).toBe(401);
    expect(prisma.attachment.findUnique).not.toHaveBeenCalled();
  });
  it("不可见附件返回 404，不返回文件内容", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(attachment as never);
    vi.mocked(canReadAttachment).mockResolvedValue(false);
    const response = await GET(new Request("http://localhost"), params);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("private");
    expect(canReadAttachment).toHaveBeenCalledWith(session, attachment);
  });
  it("可见附件仍按原安全响应头提供下载", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(attachment as never);
    vi.mocked(canReadAttachment).mockResolvedValue(true);
    const response = await GET(new Request("http://localhost"), params);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("private");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  });
  it("合格图片仍作为上传者的未关联草稿存储", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(prisma.attachment.create).mockResolvedValue({ id: "att", name: "ok.png", mime: "image/png", size: 8 } as never);
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const file = { size: bytes.length, type: "image/png", name: "ok.png", arrayBuffer: async () => bytes.buffer };
    const request = { formData: async () => ({ get: (key: string) => key === "file" ? file : "image" }) } as unknown as Request;
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "att", url: "/api/attachments/att" });
    expect(prisma.attachment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ uploaderId: "u", ownerType: "requirement", ownerId: null, mime: "image/png", size: 8 }) }));
  });
  it("超出 5MB 或文件内容与类型不符时拒绝上传且不写库", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    const form = (file: object, kind: string) => ({ formData: async () => ({ get: (key: string) => key === "file" ? file : kind }) }) as unknown as Request;
    const oversized = await POST(form({ size: 5 * 1024 * 1024 + 1 }, "file"));
    expect(oversized.status).toBe(400);
    const invalid = await POST(form({ size: 3, type: "image/png", name: "fake.png", arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }, "image"));
    expect(invalid.status).toBe(400);
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });
});
