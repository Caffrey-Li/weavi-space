import { describe, expect, it } from "vitest";
import { isReadable, priority } from "@/lib/local-folder";
import { localContext } from "@pm-collab/core/ai/chat";

describe("AI 本地文件夹", () => {
  it("只读文本文件，跳过依赖目录、密钥文件和大文件", () => {
    expect(isReadable("app/README.md", 100)).toBe(true);
    expect(isReadable("app/src/a.ts", 100)).toBe(true);
    expect(isReadable("app/node_modules/x/index.js", 100)).toBe(false);
    expect(isReadable("app/.git/config", 100)).toBe(false);
    expect(isReadable("app/.env", 100)).toBe(false);
    expect(isReadable("app/.env.local", 100)).toBe(false);
    expect(isReadable("app/logo.png", 100)).toBe(false);
    expect(isReadable("app/big.json", 300 * 1024)).toBe(false);
  });
  it("说明文档优先", () => {
    expect(priority("a/README.md", 9000)).toBeLessThan(priority("a/src/x.ts", 10));
    expect(priority("a/docs/x.txt", 9000)).toBeLessThan(priority("a/src/x.ts", 10));
  });
  it("服务端按上限截断，不信任前端传来的大小", () => {
    const ctx = localContext({ name: "demo", tree: ["a.md"], files: [{ path: "a.md", content: "x".repeat(200_000) }] });
    expect(ctx).toContain("本地文件夹「demo」");
    expect(ctx.length).toBeLessThan(81_000);
    expect(localContext(null)).toBe("");
  });
});
