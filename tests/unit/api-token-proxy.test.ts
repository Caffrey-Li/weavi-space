import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session-check", () => ({ checkPageSession: vi.fn() }));
vi.mock("@/lib/origin-check", () => ({ originAllowed: vi.fn(() => false) }));
import { proxy } from "@/proxy";

describe("v1 Bearer 与 Cookie 路由隔离", () => {
  it("v1 写请求不走 CSRF，并删除 Cookie 后透传 Authorization", async () => {
    const response = await proxy(new NextRequest("http://localhost/api/v1/requirements", { method: "POST", headers: { cookie: "pm_session=synthetic", authorization: "Bearer synthetic", origin: "https://other.test" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-cookie")).toBeNull();
    expect(response.headers.get("x-middleware-request-authorization")).toBe("Bearer synthetic");
  });
  it("看似 v1 的其他路径及旧接口仍执行 CSRF", async () => {
    for (const path of ["/api/v1other", "/api/requirements"]) {
      const response = await proxy(new NextRequest(`http://localhost${path}`, { method: "POST", headers: { origin: "https://other.test", authorization: "Bearer synthetic" } }));
      expect(response.status).toBe(403);
    }
  });
  it("Bearer 本身不能通过旧 Cookie 接口的会话检查", async () => {
    const response = await proxy(new NextRequest("http://localhost/api/requirements", { headers: { authorization: "Bearer synthetic" } }));
    expect(response.status).toBe(401);
  });
});
