import { beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("@pm-collab/core/auth", () => ({ getSession: vi.fn() }));
vi.mock("@pm-collab/core/products/detail-page-query", () => ({ findProductForPage: vi.fn(), canViewProductPage: vi.fn(), canManageProductPage: vi.fn(), loadProductIntro: vi.fn(), loadProductArchitectures: vi.fn(), loadProductTree: vi.fn() }));

import { getSession } from "@pm-collab/core/auth";
import { findProductForPage, canViewProductPage, canManageProductPage, loadProductIntro } from "@pm-collab/core/products/detail-page-query";
import ProductDetailPage from "@/app/(app)/products/[id]/page";

beforeEach(() => vi.resetAllMocks());
it("产品详情页对跨企业产品执行 notFound", async () => {
  vi.mocked(findProductForPage).mockResolvedValue({ id: "other" } as never);
  vi.mocked(getSession).mockResolvedValue({ id: "u", email: "u@example.test", name: "U", globalRole: "member" });
  vi.mocked(canViewProductPage).mockResolvedValue(0);
  await expect(ProductDetailPage({ params: Promise.resolve({ id: "other" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(canManageProductPage).not.toHaveBeenCalled();
  expect(loadProductIntro).not.toHaveBeenCalled();
});
