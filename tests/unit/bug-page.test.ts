import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("@pm-collab/core/auth", () => ({ getSession: vi.fn() }));
vi.mock("@pm-collab/core/bugs/detail-page-query", () => ({ findBugForPage: vi.fn(), canViewBugPage: vi.fn(), loadBugPageDetails: vi.fn() }));

import { getSession } from "@pm-collab/core/auth";
import { findBugForPage, canViewBugPage, loadBugPageDetails } from "@pm-collab/core/bugs/detail-page-query";
import BugDetailPage from "@/app/(app)/bugs/[id]/page";

const session = { id: "u", email: "u@example.test", name: "U", globalRole: "member" };

describe("Bug 详情页", () => {
  beforeEach(() => vi.resetAllMocks());
  it("跨企业不可见时执行 notFound，不读取后续详情", async () => {
    vi.mocked(findBugForPage).mockResolvedValue({ id: "other", deletedAt: null } as never);
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(canViewBugPage).mockResolvedValue(false);
    await expect(BugDetailPage({ params: Promise.resolve({ id: "other" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loadBugPageDetails).not.toHaveBeenCalled();
  });
});
