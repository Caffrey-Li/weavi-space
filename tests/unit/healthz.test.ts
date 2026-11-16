import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@pm-collab/db/prisma", () => ({ prisma: { workspace: { count: vi.fn() } } }));
vi.mock("@/lib/session-check", () => ({ checkPageSession: vi.fn() }));
import { prisma } from "@pm-collab/db/prisma";
import { GET } from "../../apps/web/src/app/api/healthz/route";
import { proxy } from "@/proxy";

describe("健康检查", () => {
  beforeEach(() => vi.resetAllMocks());
  it("数据库可用时 200，只返回状态", async () => {
    vi.mocked(prisma.workspace.count).mockResolvedValue(1);
    const r = await GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ok" });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("数据库不可用时 503，不暴露错误内容", async () => {
    vi.mocked(prisma.workspace.count).mockRejectedValue(new Error("connect ECONNREFUSED secret-host"));
    const r = await GET();
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain("secret-host");
  });
  it("不登录也能访问 /api/healthz，其他接口仍要登录", async () => {
    expect((await proxy(new NextRequest("http://localhost/api/healthz"))).status).toBe(200);
    expect((await proxy(new NextRequest("http://localhost/api/healthz-other"))).status).toBe(401);
    expect((await proxy(new NextRequest("http://localhost/api/projects"))).status).toBe(401);
  });
});
