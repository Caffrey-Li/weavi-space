import { describe, expect, it } from "vitest";
import { GitLab, branchNameFor, cleanBaseUrl, validBranchName } from "@pm-collab/core/git/client";

describe("T44 GitLab 客户端", () => {
  it("地址：只收 http(s)，去掉末尾斜杠，拒绝账号密码和参数", () => {
    expect(cleanBaseUrl("https://gitlab.com/")).toBe("https://gitlab.com");
    expect(cleanBaseUrl("http://10.0.0.5:8080/gitlab/")).toBe("http://10.0.0.5:8080/gitlab");
    expect(cleanBaseUrl("ftp://x")).toBeNull();
    expect(cleanBaseUrl("git.example.com/")).toBe("https://git.example.com");
    expect(cleanBaseUrl("https://u:p@git.x.com")).toBeNull();
    expect(cleanBaseUrl("https://git.x.com/?a=1")).toBeNull();
    expect(cleanBaseUrl("javascript:alert(1)")).toBeNull();
  });
  it("分支名带编号，中文标题只留编号", () => {
    expect(branchNameFor("R1042", "导出报表 Export Range!")).toBe("feature/R1042-export-range");
    expect(branchNameFor("R1042", "导出报表")).toBe("feature/R1042");
    expect(validBranchName("feature/R1042-x")).toBe(true);
    for (const bad of ["a..b", "/a", "a/", "a b", "a~1", "x.lock"]) expect(validBranchName(bad)).toBe(false);
  });
  it("请求带令牌、不跟随跳转，错误转成中文", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/user")) return new Response(JSON.stringify({ username: "caffrey", name: "C" }), { status: 200 });
      return new Response("nope", { status: 401 });
    }) as unknown as typeof fetch;
    const gl = new GitLab("https://git.x.com", "glpat-abc", fake);
    expect(await gl.user()).toEqual({ username: "caffrey", name: "C" });
    expect(calls[0].url).toBe("https://git.x.com/api/v4/user");
    expect((calls[0].init.headers as Record<string, string>)["PRIVATE-TOKEN"]).toBe("glpat-abc");
    expect(calls[0].init.redirect).toBe("error");
    await expect(gl.project("a/b")).rejects.toThrow("访问令牌无效或已过期");
    expect(calls[1].url).toBe("https://git.x.com/api/v4/projects/a%2Fb");
  });
});
