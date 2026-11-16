import { beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("@pm-collab/core/auth", () => ({ getSession: vi.fn() }));
vi.mock("@pm-collab/core/releases/detail-page-query", () => ({ findReleaseForPage: vi.fn(), canViewReleasePage: vi.fn(), loadReleasePageDetails: vi.fn() }));

import { getSession } from "@pm-collab/core/auth";
import { findReleaseForPage, canViewReleasePage, loadReleasePageDetails } from "@pm-collab/core/releases/detail-page-query";
import ReleaseDetailPage from "@/app/(app)/releases/[id]/page";

beforeEach(() => vi.resetAllMocks());
it("发版详情页对不可见项目执行 notFound", async () => {
  vi.mocked(findReleaseForPage).mockResolvedValue({ id: "r", projectId: "other" } as never);
  vi.mocked(getSession).mockResolvedValue({ id: "u", email: "u@example.test", name: "U", globalRole: "member" });
  vi.mocked(canViewReleasePage).mockResolvedValue(false);
  await expect(ReleaseDetailPage({ params: Promise.resolve({ id: "r" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(loadReleasePageDetails).not.toHaveBeenCalled();
});
