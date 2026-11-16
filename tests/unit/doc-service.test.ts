import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    docPage: { findUnique: vi.fn() },
    docGroup: { create: vi.fn() },
  },
}));
vi.mock("@pm-collab/core/docs/docs-query", () => ({ canViewSpace: vi.fn(), canEditDocs: vi.fn() }));
vi.mock("@pm-collab/core/shared/doc-groups", () => ({ listDocGroups: vi.fn() }));

import { prisma } from "@pm-collab/db/prisma";
import { canEditDocs, canViewSpace } from "@pm-collab/core/docs/docs-query";
import { listDocGroups } from "@pm-collab/core/shared/doc-groups";
import { POST } from "@pm-collab/core/docs/space-groups";

const session = { id: "u", email: "u@example.test", name: "U", globalRole: "member" };
describe("文档服务原有校验顺序", () => {
  beforeEach(() => vi.resetAllMocks());
  it("空间不存在先返回 404，不检查权限、不读取或写入分组", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
    expect(await POST(session, { id: "foreign" }, { url: "", body: {} })).toEqual({ body: { error: "空间不存在" }, init: { status: 404 } });
    expect(canViewSpace).not.toHaveBeenCalled();
    expect(listDocGroups).not.toHaveBeenCalled();
    expect(prisma.docGroup.create).not.toHaveBeenCalled();
  });
  it("空间可见但无编辑权限先拒绝，不进入请求体名称校验或后续读写", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: "s" } as never);
    vi.mocked(canViewSpace).mockResolvedValue(true);
    vi.mocked(canEditDocs).mockResolvedValue(false);
    expect(await POST(session, { id: "s" }, { url: "", body: {} })).toEqual({ body: { error: "无权编辑该空间的文档" }, init: { status: 403 } });
    const order = [canViewSpace, canEditDocs].map((f) => (f as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
    expect(order[0]).toBeLessThan(order[1]);
    expect(listDocGroups).not.toHaveBeenCalled();
    expect(prisma.docGroup.create).not.toHaveBeenCalled();
  });
});
