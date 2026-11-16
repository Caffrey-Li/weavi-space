import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pm-collab/db/prisma", () => ({ prisma: {
  project: { findUnique: vi.fn() }, requirement: { create: vi.fn(), aggregate: vi.fn() },
  bug: { create: vi.fn(), aggregate: vi.fn() },
} }));
vi.mock("@pm-collab/core/permissions", () => ({ can: vi.fn() }));
vi.mock("@pm-collab/core/shared/cascade", () => ({ alignToProjects: vi.fn() }));
vi.mock("@pm-collab/core/shared/attachments", () => ({ linkAttachments: vi.fn() }));

import { POST as createRequirement } from "@pm-collab/core/requirements/root";
import { POST as createBug } from "@pm-collab/core/bugs/index";
import { prisma } from "@pm-collab/db/prisma";
import { can } from "@pm-collab/core/permissions";

const user = { id: "u", email: "u@example.test", name: "U", globalRole: "member" };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(can).mockResolvedValue(true); });

describe("开放接口使用原有服务的校验顺序", () => {
  it("文档链接错误优先于不可见父需求，且不写业务数据", async () => {
    const guard = vi.fn().mockResolvedValue(false);
    const result = await createRequirement(user, { title: "test", docUrl: "javascript:bad", parentId: "foreign" }, guard);
    expect(result.init?.status).toBe(400);
    expect(result.body).toEqual({ error: "文档链接需以 http(s):// 开头" });
    expect(guard).not.toHaveBeenCalled();
    expect(prisma.requirement.create).not.toHaveBeenCalled();
  });
  it("不可见项目返回 404，且不查询或写入项目业务数据", async () => {
    const guard = vi.fn().mockResolvedValue(false);
    const result = await createRequirement(user, { title: "test", projectId: "foreign" }, guard);
    expect(result.init?.status).toBe(404);
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
    expect(prisma.requirement.create).not.toHaveBeenCalled();
  });
  it("Bug 非法严重程度优先于不可见项目，且不写业务数据", async () => {
    const guard = vi.fn().mockResolvedValue(false);
    const result = await createBug(user, { title: "test", projectId: "foreign", severity: "bad" }, guard);
    expect(result.init?.status).toBe(400);
    expect(result.body).toEqual({ error: "非法严重级别" });
    expect(guard).not.toHaveBeenCalled();
    expect(prisma.bug.create).not.toHaveBeenCalled();
  });
});
