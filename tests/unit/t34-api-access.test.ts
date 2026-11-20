import { describe, expect, it } from "vitest";
import { allowedScopes, effectiveScopes, parsePolicy } from "@pm-collab/core/api-tokens/policy";
import { v1Action } from "@pm-collab/core/api-tokens/access-log";
import { API_SCOPES } from "@pm-collab/core/api-tokens/scopes";

describe("T34 数据开放策略解析", () => {
  it("没配置过 = 允许全部范围", () => {
    expect(parsePolicy(null)).toEqual({ allowTokens: true, scopes: [...API_SCOPES] });
  });
  it("去掉未知范围和重复", () => {
    expect(parsePolicy(JSON.stringify({ allowTokens: true, scopes: ["docs.read", "x.y", "docs.read"] }))).toEqual({ allowTokens: true, scopes: ["docs.read"] });
  });
  it("读不出来时按最严处理", () => {
    expect(parsePolicy("{坏的")).toEqual({ allowTokens: false, scopes: [] });
  });
  it("生效范围取交集，关闭时为空", () => {
    expect(effectiveScopes(["docs.read", "bugs.edit", "nope"], { allowTokens: true, scopes: ["bugs.edit"] })).toEqual(["bugs.edit"]);
    expect(effectiveScopes(["docs.read"], { allowTokens: false, scopes: ["docs.read"] })).toEqual([]);
    expect(allowedScopes({ allowTokens: true, scopes: ["bugs.edit", "docs.read"] })).toEqual(["docs.read", "bugs.edit"]);
    expect(allowedScopes({ allowTokens: false, scopes: ["docs.read"] })).toEqual([]);
  });
});

describe("T34 调用记录的接口名", () => {
  it.each([
    [["requirements", "abc123"], "GET /requirements/:id"],
    [["requirements", "abc123", "status"], "GET /requirements/:id/status"],
    [["docs", "spaces", "p1", "pages"], "GET /docs/spaces/:id/pages"],
    [["projects", "p1", "progress"], "GET /projects/:id/progress"],
    [["members"], "GET /members"],
  ])("%j → %s", (path, want) => expect(v1Action("GET", path as string[])).toBe(want));
});
