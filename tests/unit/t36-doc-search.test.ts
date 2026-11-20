import { describe, expect, it } from "vitest";
import { plainText, questionGrams, scoreOf, searchTerms, snippetOf } from "@pm-collab/core/docs/search";

describe("T36 文档检索：关键词", () => {
  it("按空格切开、去重、最多 5 个", () => {
    expect(searchTerms("  登录  验证码 登录 ")).toEqual(["登录", "验证码"]);
    expect(searchTerms("a b c d e f g")).toHaveLength(5);
    expect(searchTerms("   ")).toEqual([]);
  });
  it("正文去标签和实体", () => expect(plainText("<p>登录&nbsp;<b>失败</b> &lt;x&gt;</p>")).toBe("登录 失败 <x>"));
  it("摘要截取命中词附近", () => {
    const text = `${"甲".repeat(100)}验证码过期${"乙".repeat(100)}`;
    const s = snippetOf(text, ["验证码"], 10);
    expect(s).toContain("验证码");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
  });
  it("标题命中比正文命中分高", () => {
    expect(scoreOf("登录流程", "无关", ["登录"])).toBeGreaterThan(scoreOf("其他", "登录 登录", ["登录"]));
  });
});

describe("T36 AI 对话的检索片段", () => {
  it("去掉虚词，短片段整段保留，长片段切成两字", () => {
    expect(questionGrams("退款怎么处理？")).toEqual(["退款", "处理"]);
    expect(questionGrams("会员积分兑换规则")).toEqual(["会员", "员积", "积分", "分兑", "兑换", "换规", "规则"]);
    expect(questionGrams("OAuth 登录的 token 有效期")).toEqual(["oauth", "登录", "token", "有效期"]);
  });
  it("没有有效片段时为空", () => expect(questionGrams("吗？的")).toEqual([]));
});
