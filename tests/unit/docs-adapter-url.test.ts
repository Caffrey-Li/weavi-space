import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/core/auth", () => ({ getSession: vi.fn() }));
vi.mock("@pm-collab/core/docs/list", () => ({ GET: vi.fn().mockResolvedValue({ body: { ok: true } }) }));
vi.mock("@pm-collab/core/docs/ref-search", () => ({ GET: vi.fn().mockResolvedValue({ body: { ok: true } }) }));
vi.mock("@pm-collab/core/docs/page-links", () => ({ DELETE: vi.fn().mockResolvedValue({ body: { ok: true } }) }));
vi.mock("@pm-collab/core/docs/space-groups", () => ({ DELETE: vi.fn().mockResolvedValue({ body: { ok: true } }) }));

import { getSession } from "@pm-collab/core/auth";
import { GET as list } from "../../apps/web/src/docs/list";
import { GET as refSearch } from "../../apps/web/src/docs/ref-search";
import { DELETE as deleteLink } from "../../apps/web/src/docs/page-links";
import { DELETE as deleteGroup } from "../../apps/web/src/docs/space-groups";
import { GET as listService } from "@pm-collab/core/docs/list";
import { GET as refSearchService } from "@pm-collab/core/docs/ref-search";
import { DELETE as deleteLinkService } from "@pm-collab/core/docs/page-links";
import { DELETE as deleteGroupService } from "@pm-collab/core/docs/space-groups";

const session = { id: "u", email: "u@example.test", name: "U", globalRole: "member" };
const url = "http://localhost/api/docs/list?q=hello";
const request = () => new Request(url, { method: "DELETE", body: "{}" });
describe("文档适配器保留真实请求 URL", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getSession).mockResolvedValue(session); });
  it.each([
    ["文档列表", () => list(new Request(url)), listService],
    ["引用搜索", () => refSearch(new Request(url)), refSearchService],
    ["删除文档关联", () => deleteLink(request(), { params: Promise.resolve({ id: "p" }) }), deleteLinkService],
    ["删除文档分组", () => deleteGroup(request(), { params: Promise.resolve({ id: "s" }) }), deleteGroupService],
  ])("%s", async (_name, call, service) => {
    await call();
    expect(vi.mocked(service as ReturnType<typeof vi.fn>).mock.calls[0].at(-1).url).toBe(url);
  });
});
