import { describe, expect, it, vi } from "vitest";
vi.mock("@pm-collab/core/shared/secure-config", () => ({ sealText: (s: string) => `enc:${s}`, openText: (s: string | null) => (s ? s.replace(/^enc:/, "") : null) }));
import { cleanLoginInput, needsLogin, parseLoginConfig, pickAccount } from "@pm-collab/core/delivery/login-config";
import { allowRequest } from "@pm-collab/core/delivery/runner";

describe("T55 自动登录与换账号", () => {
  it("前置条件写了登录才自动登录，未登录的不登录", () => {
    expect(needsLogin("使用 {{username}} / {{password}} 登录，账号为 V1 会员")).toBe(true);
    expect(needsLogin("浏览器处于未登录状态")).toBe(false);
    expect(needsLogin("")).toBe(false);
  });
  it("按顺序匹配关键词，先匹配上的先用；都不匹配用默认账号", () => {
    const cfg = cleanLoginInput({ path: "/login", accounts: [{ match: "运营角色", username: "op", password: "p1" }, { match: "V2 会员", username: "v2", password: "p2" }] }, null)!;
    const fb = { username: "me", password: "pw" };
    expect(pickAccount(cfg, "登录运营角色账号，V2 会员门槛 1000", fb)).toMatchObject({ username: "op", password: "p1" });
    expect(pickAccount(cfg, "账号为 V2 会员", fb)).toMatchObject({ username: "v2", password: "p2" });
    expect(pickAccount(cfg, "账号为 V1 会员", fb)).toMatchObject({ username: "me", password: "pw", match: null });
  });
  it("密码留空沿用原来的；关闭后清空；路径必须以 / 开头", () => {
    const a = cleanLoginInput({ path: "/login", accounts: [{ match: "V3", username: "v3", password: "x" }] }, null)!;
    const b = cleanLoginInput({ path: "/login", accounts: [{ match: "V3", username: "v3", password: "" }] }, parseLoginConfig(a))!;
    expect(b.accounts[0].passEnc).toBe("enc:x");
    expect(cleanLoginInput({ enabled: false }, a)).toBeNull();
    expect(() => cleanLoginInput({ path: "login" }, null)).toThrow();
    expect(() => cleanLoginInput({ path: "/login", accounts: [{ match: "V3", username: "" }] }, null)).toThrow();
  });
  it("测试站是本机地址：登记为测试环境时同 host 放行", () => {
    expect(allowRequest("http://member-test.localhost:3100/my", "member-test.localhost:3100", true)).toBe(true);
    expect(allowRequest("http://localhost:3100/api/me", "member-test.localhost:3100", true)).toBe(false);
  });
});
