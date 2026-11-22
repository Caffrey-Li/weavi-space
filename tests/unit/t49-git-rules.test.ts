import { describe, expect, it } from "vitest";
import { branchCounts, cleanBranchPatterns, closingCodes, isDraftMr, isMergeCommit, isRevertCommit } from "@pm-collab/core/git/rules";

describe("T49 代码流转规则", () => {
  it("关闭词：Closes / Fix / 完成 / 解决 后面的编号才算完成，只是提到的不算", () => {
    expect(closingCodes("顺手修了 T1005 的样式；Closes T1004, T1006 and R1042")).toEqual({ reqs: [1042], tasks: [1004, 1006] });
    expect(closingCodes("完成 T1004、T1007\n修复：R1050")).toEqual({ reqs: [1050], tasks: [1004, 1007] });
    expect(closingCodes("参考 T1005，和 T1008 有关")).toEqual({ reqs: [], tasks: [] });
    expect(closingCodes("prefix T1009 done")).toEqual({ reqs: [], tasks: [] });
  });
  it("合并提交、Revert、草稿 MR", () => {
    expect(isMergeCommit("Merge branch 'feature/R1' into 'main'")).toBe(true);
    expect(isMergeCommit("Merge remote-tracking branch 'origin/main'")).toBe(true);
    expect(isMergeCommit("merge 时的冲突修一下 T1004")).toBe(false);
    expect(isRevertCommit('Revert "feat: x T1004"\n\nThis reverts commit 1234567890ab.')).toBe(true);
    expect(isRevertCommit("feat: 撤销按钮 T1004")).toBe(false);
    expect(isDraftMr("Draft: 筛选 T1004")).toBe(true);
    expect(isDraftMr("[WIP] 筛选")).toBe(true);
    expect(isDraftMr("筛选 T1004", true)).toBe(true);
    expect(isDraftMr("Drafting 规则")).toBe(false);
  });
  it("算完成的分支：默认只认默认分支，支持通配", () => {
    expect(branchCounts("main", "", "main")).toBe(true);
    expect(branchCounts("develop", "", "main")).toBe(false);
    expect(branchCounts("release/2.4", "main,master,release/*", "main")).toBe(true);
    expect(branchCounts("release-2.4", "main,release/*", "main")).toBe(false);
    expect(cleanBranchPatterns(" main， release/* ")).toBe("main,release/*");
    expect(cleanBranchPatterns("main;rm -rf")).toBeNull();
  });
});
