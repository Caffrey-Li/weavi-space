import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@pm-collab/db/prisma", () => ({ prisma: { docPage: { findUnique: vi.fn(), update: vi.fn() }, docPageStar: { findUnique: vi.fn(), findMany: vi.fn() } } }));
vi.mock("@pm-collab/core/docs/docs-query", () => ({ canViewSpace: vi.fn(), spaceWhere: vi.fn(async () => ({ projectId: { some: {} } })), canEditDocs: vi.fn(), ancestorsOf: vi.fn(), loadRefInfo: vi.fn() }));
vi.mock("@pm-collab/core/shared/doc-html", () => ({ extractRefs: vi.fn(() => []), renderDocHtml: vi.fn(() => ({ html: "", toc: [] })) }));
import { prisma } from "@pm-collab/db/prisma";
import { canViewSpace, canEditDocs, spaceWhere } from "@pm-collab/core/docs/docs-query";
import { pageRead } from "@pm-collab/core/docs/page-read-query";
import { loadStars } from "@pm-collab/core/docs/starred-query";
const session = { id: "u", email: "u@example.test", name: "U", globalRole: "member" };
describe("文档页面不可见", () => {
  beforeEach(() => vi.resetAllMocks());
  it("空间不可读返回原 notFound 状态，不增加浏览量、不查子页", async () => {
    vi.mocked(prisma.docPage.findUnique).mockResolvedValue({ id: "p", projectId: "s", deletedAt: null } as never);
    vi.mocked(canViewSpace).mockResolvedValue(false);
    expect(await pageRead(session, "s", "p")).toEqual({ state: "notFound" });
    expect(canEditDocs).not.toHaveBeenCalled();
    expect(prisma.docPage.update).not.toHaveBeenCalled();
    expect(prisma.docPageStar.findUnique).not.toHaveBeenCalled();
  });
  it("星标列表把用户 ID 与原空间范围一起传入数据库查询", async () => {
    await loadStars(session);
    expect(spaceWhere).toHaveBeenCalledWith(session);
    expect(prisma.docPageStar.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: session.id, page: { deletedAt: null, archivedAt: null, project: { projectId: { some: {} } } } } }));
  });
});
