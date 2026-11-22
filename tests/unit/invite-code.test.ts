import { describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({ prisma: {} }));

import { accountLabel, formatInviteCode, isUnboundEmail, normalizeInviteCode } from "@pm-collab/core/shared/unbound-account";
import { inviteTokenFrom } from "@pm-collab/core/login/invite-entry";

describe("邀请码", () => {
  it("不分大小写、可带短横线和空格；去掉易混字符的才算", () => {
    expect(normalizeInviteCode("k7qm-3xpa")).toBe("K7QM3XPA");
    expect(normalizeInviteCode(" K7QM 3XPA ")).toBe("K7QM3XPA");
    expect(normalizeInviteCode("K7QM-3XP0")).toBe(""); // 0 不在字母表
    expect(normalizeInviteCode("K7QM3XP")).toBe("");
    expect(formatInviteCode("K7QM3XPA")).toBe("K7QM-3XPA");
  });
  it("从链接、旧地址或单独的码里取出令牌", () => {
    expect(inviteTokenFrom("https://a.com/login?invite=K7QM3XPA")).toBe("K7QM3XPA");
    expect(inviteTokenFrom("k7qm-3xpa")).toBe("K7QM3XPA");
    const long = "hgZGwKtXAsX9qQa76HPZnpuviEWARkc5ZTHEfi2Op8U";
    expect(inviteTokenFrom(`https://a.com/invite/${long}`)).toBe(long);
    expect(inviteTokenFrom(long)).toBe(long);
    expect(inviteTokenFrom("abc")).toBe("");
  });
  it("占位邮箱显示未绑定", () => {
    expect(isUnboundEmail("u-1@unbound.invalid")).toBe(true);
    expect(isUnboundEmail("a@b.com")).toBe(false);
    expect(accountLabel("u-1@unbound.invalid")).toBe("未绑定邮箱");
    expect(accountLabel("a@b.com")).toBe("a@b.com");
  });
});
