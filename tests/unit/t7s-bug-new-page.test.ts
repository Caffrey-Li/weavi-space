import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@pm-collab/core/auth", () => ({ getSession: vi.fn() }));
vi.mock("@pm-collab/core/bugs/new-page-query", () => ({ loadNewBugPage: vi.fn() }));
import { getSession } from "@pm-collab/core/auth";
import { loadNewBugPage } from "@pm-collab/core/bugs/new-page-query";
import NewBugPage from "@/app/(app)/bugs/new/page";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: "u", email: "u@example.test", name: "U", globalRole: "member" });
});
it("不可见项目与需求按不存在处理时不锁住项目选择", async () => {
  vi.mocked(loadNewBugPage).mockResolvedValue({ requirement: null, project: null, allowed: true });
  const page = await NewBugPage({ searchParams: Promise.resolve({ project: "other", requirement: "other-req" }) });
  expect(page.props.children[1].props.lockProject).toBe(false);
  expect(page.props.children[1].props.initialProject).toBeNull();
});
it("可见公共池需求仍保持原有锁定行为", async () => {
  vi.mocked(loadNewBugPage).mockResolvedValue({ requirement: { id: "r", number: 1001, title: "需求", projectId: null, productId: null, productNodeId: null, project: null }, project: null, allowed: true });
  const page = await NewBugPage({ searchParams: Promise.resolve({ requirement: "r" }) });
  expect(page.props.children[1].props.lockProject).toBe(true);
});
