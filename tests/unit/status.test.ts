import { describe, expect, it, vi } from "vitest";
vi.mock("@pm-collab/db/prisma", () => ({ prisma: {} }));
import { countBugReturns, isBugReturn } from "@pm-collab/core/bugs/write";
import { isReqDone, normalizeReqStatus, REQ_BOARD_COLUMNS, reqStatusLabel, statusesForStage } from "@pm-collab/core/shared/constants";

describe("状态流转", () => {
  it.each(["resolved", "closed"])("%s 退回三种进行状态会计数", (from) => {
    for (const to of ["open", "in_progress", "reopened"]) expect(isBugReturn(from, to)).toBe(true);
    for (const to of ["resolved", "closed", "cancelled"]) expect(isBugReturn(from, to)).toBe(false);
  });
  it("普通状态变化和无效日志不计退回", () => {
    expect(isBugReturn("open", "in_progress")).toBe(false);
    expect(countBugReturns([{ entityId: "a", fromValue: '{"status":"closed"}', toValue: '{"status":"open"}' }, { entityId: "a", fromValue: "invalid", toValue: null }]).get("a")).toBe(1);
  });
  it("旧需求状态归一化，仅上线算完成", () => {
    expect(normalizeReqStatus("done")).toBe("online");
    expect(normalizeReqStatus("已完成")).toBe("test_done");
    expect(isReqDone("test_done")).toBe(false);
    expect(isReqDone("online")).toBe(true);
    expect(REQ_BOARD_COLUMNS.some((s) => s.key === ("cancelled" as string))).toBe(false);
    expect(statusesForStage("dev")).toEqual(["dev_todo", "dev_in_progress", "dev_done"]);
  });
  it("11-06 前存库的中文状态名都能换成英文 key，key 本身不变", () => {
    const pairs: [string, string][] = [["需求中", "req_in_progress"], ["需求完成", "req_done"], ["待开发", "dev_todo"], ["开发中", "dev_in_progress"], ["开发完成", "dev_done"], ["待测试", "test_todo"], ["测试中", "test_in_progress"], ["测试完成", "test_done"], ["已上线", "online"], ["已取消", "cancelled"]];
    for (const [label, key] of pairs) {
      expect(normalizeReqStatus(label)).toBe(key);
      expect(normalizeReqStatus(key)).toBe(key);
      expect(reqStatusLabel(key)).toBe(label);
    }
    expect(normalizeReqStatus("已上线【内测版】")).toBe("online");
    expect(normalizeReqStatus("")).toBe("req_in_progress");
  });
});
