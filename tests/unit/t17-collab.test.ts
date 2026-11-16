import { describe, expect, it } from "vitest";
import { layoutFor } from "@pm-collab/core/workbench/role-query";
import { weekOf } from "@pm-collab/core/reports/service";

describe("工作台版式", () => {
  it.each([
    ["admin", "product", "manager"],
    ["manager", "frontend", "manager"],
    ["member", "product", "product"],
    ["member", "pm", "project"],
    ["member", "business", "business"],
    ["member", "frontend", "dev"],
    ["member", "qa", "dev"],
    ["member", null, "dev"],
  ])("角色 %s 岗位 %s → %s", (role, pos, want) => expect(layoutFor(role as string, pos as string | null)).toBe(want));
});

describe("周报的周", () => {
  it("取周一（UTC 日期）", () => {
    expect(weekOf(new Date(2026, 10, 15, 22, 0)).toISOString().slice(0, 10)).toBe("2026-11-09"); // 周日 → 本周一
    expect(weekOf(new Date(2026, 10, 9, 0, 30)).toISOString().slice(0, 10)).toBe("2026-11-09");
  });
});
