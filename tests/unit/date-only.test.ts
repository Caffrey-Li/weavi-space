import { describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({ prisma: {} }));

import { parseDate } from "@pm-collab/core/requirement-write";
import { dayNoon, ymd } from "@pm-collab/core/shared/release-schedule-shared";
import { parseSheetDate } from "@pm-collab/core/shared/itr-sync";

describe("只有日期的字段", () => {
  it("YYYY-MM-DD 存当天 12:00 UTC，任何 ±11 时区都显示同一天", () => {
    const d = parseDate("2026-11-29")!;
    expect(d.toISOString()).toBe("2026-11-29T12:00:00.000Z");
    expect(ymd(d)).toBe("2026-11-29");
    for (const offset of [-11, -7, 0, 8, 11]) {
      const local = new Date(d.getTime() + offset * 3600_000);
      expect(local.getUTCDate()).toBe(29);
    }
  });
  it("带时间的值照原样", () => {
    expect(parseDate("2026-11-29T08:30:00Z")!.toISOString()).toBe("2026-11-29T08:30:00.000Z");
    expect(parseDate("")).toBeNull();
    expect(parseDate("not-a-date")).toBeNull();
  });
  it("dayNoon / 表格日期", () => {
    expect(dayNoon("2026-03-01")!.toISOString()).toBe("2026-03-01T12:00:00.000Z");
    expect(dayNoon("bad")).toBeNull();
    expect(parseSheetDate("2026/1/5")!.toISOString()).toBe("2026-01-05T12:00:00.000Z");
  });
});
