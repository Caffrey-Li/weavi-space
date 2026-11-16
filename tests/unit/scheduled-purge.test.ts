import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ docs: vi.fn(), deleteDoc: vi.fn(), requirements: vi.fn(), bugs: vi.fn(), projects: vi.fn(), products: vi.fn() }));
vi.mock("@pm-collab/db/prisma", () => ({ prisma: {
  docPage: { findMany: mock.docs, deleteMany: mock.deleteDoc }, requirement: { findMany: mock.requirements }, bug: { findMany: mock.bugs }, project: { findMany: mock.projects }, product: { findMany: mock.products },
} }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn() }));
vi.mock("@pm-collab/core/access", () => ({ bugWhere: vi.fn(), getAccess: vi.fn(), productWhere: vi.fn(), requirementWhere: vi.fn() }));
import { purgeExpired, purgeExpiredForQueue } from "@pm-collab/core/shared/lifecycle";
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mock.docs.mockResolvedValue([{ id: "bad" }, { id: "good" }]);
  mock.requirements.mockResolvedValue([]); mock.bugs.mockResolvedValue([]); mock.projects.mockResolvedValue([]); mock.products.mockResolvedValue([]);
  mock.deleteDoc.mockRejectedValueOnce(new Error("failure")).mockResolvedValueOnce({ count: 1 });
});
afterEach(() => vi.restoreAllMocks());
it("旧清理接口继续处理其他项目并返回成功数量", async () => {
  expect(await purgeExpired()).toBe(1);
  expect(mock.deleteDoc).toHaveBeenCalledTimes(2);
});
it("队列清理在处理其他项目后向队列抛出单项失败，允许重试", async () => {
  await expect(purgeExpiredForQueue()).rejects.toThrow("部分回收站内容清理失败");
  expect(mock.deleteDoc).toHaveBeenCalledTimes(2);
});
