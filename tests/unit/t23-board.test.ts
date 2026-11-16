import { describe, expect, it } from "vitest";
import { boardText, emptyBoard, sanitizeBoardScene } from "@pm-collab/core/shared/board";
import { cleanMermaid } from "@pm-collab/core/docs/board-ai";

const el = (o: Record<string, unknown>) => ({ id: "e1", type: "rectangle", x: 0, y: 0, width: 10, height: 10, ...o });

describe("画布内容校验", () => {
  it("只保留白名单图形，去掉嵌入网页", () => {
    const out = JSON.parse(sanitizeBoardScene({ elements: [el({}), el({ id: "e2", type: "embeddable", link: "https://evil.example" }), el({ id: "e3", type: "iframe" })] })!);
    expect(out.elements.map((e: { id: string }) => e.id)).toEqual(["e1"]);
  });
  it("链接只留 http(s) 和站内地址", () => {
    const out = JSON.parse(sanitizeBoardScene({ elements: [el({ link: "javascript:alert(1)" }), el({ id: "e2", link: "https://ok.example/a" }), el({ id: "e3", link: "/docs/x" }), el({ id: "e4", link: "//evil.example" })] })!);
    expect(out.elements.map((e: { link: string | null }) => e.link)).toEqual([null, "https://ok.example/a", "/docs/x", null]);
  });
  it("图片只收 png/jpeg/gif/webp 的 data URL，且只留被引用的", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const out = JSON.parse(sanitizeBoardScene({ elements: [el({ id: "i1", type: "image", fileId: "f1" }), el({ id: "i2", type: "image", fileId: "f2" })], files: { f1: { dataURL: png }, f2: { dataURL: "data:image/svg+xml;base64,PHN2Zz4=" }, f3: { dataURL: png } } })!);
    expect(Object.keys(out.files)).toEqual(["f1"]);
  });
  it("坏 JSON、太大的内容拒绝；空内容给空画布", () => {
    expect(sanitizeBoardScene("{oops")).toBeNull();
    expect(sanitizeBoardScene("x".repeat(7 * 1024 * 1024))).toBeNull();
    expect(JSON.parse(sanitizeBoardScene("")!).elements).toEqual([]);
  });
  it("颜色只认合法写法，不信任原型污染字段", () => {
    const out = JSON.parse(sanitizeBoardScene(JSON.stringify({ elements: [{ ...el({ strokeColor: "url(javascript:x)" }), ["__proto__"]: { hacked: 1 } }] }))!);
    expect(out.elements[0].strokeColor).toBe("#1e1e1e");
    expect(({} as Record<string, unknown>).hacked).toBeUndefined();
  });
  it("模板标记只在空画布上保留", () => {
    expect(JSON.parse(sanitizeBoardScene(emptyBoard("flow"))!).template).toBe("flow");
    expect(JSON.parse(sanitizeBoardScene({ elements: [el({})], template: "flow" })!).template).toBeUndefined();
  });
  it("文字摘要只取文字元素", () => {
    expect(boardText(JSON.stringify({ elements: [{ type: "text", text: "开始" }, { type: "rectangle" }, { type: "text", text: "结束", isDeleted: true }] }))).toBe("开始");
  });
});

describe("让小围画", () => {
  it("去掉模型回复里的代码块标记", () => {
    expect(cleanMermaid("好的：\n```mermaid\nflowchart LR\n A-->B\n```")).toBe("flowchart LR\n A-->B");
    expect(cleanMermaid("flowchart TD\n A-->B")).toBe("flowchart TD\n A-->B");
  });
});
