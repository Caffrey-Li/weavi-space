import { describe, expect, it } from "vitest";
import { planSync, type FsDept, type FsUser } from "@pm-collab/core/orgs/feishu-sync";

const base = () => ({
  enterpriseId: "ent",
  orgs: [{ id: "ent", name: "甲企业", parentId: "org_nova_collab", type: "enterprise" }, { id: "o-dev", name: "研发部", parentId: "ent", type: "department" }],
  mapping: new Map([["0", "ent"], ["fd-dev", "o-dev"]]),
  identities: new Map<string, string>(),
  members: [
    { id: "u1", name: "张三", email: "zhang@acme.com", orgId: "ent", isActive: true, globalRole: "member" },
    { id: "boss", name: "老板", email: "boss@acme.com", orgId: "ent", isActive: true, globalRole: "manager" },
  ],
  protectedIds: new Set(["boss"]),
  options: { createUsers: false, moveUsers: false, deactivate: false },
});
const depts: FsDept[] = [{ id: "fd-dev", name: "研发中心", parentId: "0" }, { id: "fd-qa", name: "测试组", parentId: "fd-dev" }];
const user = (o: Partial<FsUser>): FsUser => ({ id: "ou", name: "某人", email: "", mobile: "", deptIds: ["0"], resigned: false, ...o });

describe("T40 飞书组织同步：部门", () => {
  it("已对应的改名，新的新建（带上级），飞书没有的只列出", () => {
    const b = base();
    b.mapping.set("fd-old", "o-dev2");
    b.orgs.push({ id: "o-dev2", name: "旧部门", parentId: "ent", type: "department" });
    const p = planSync({ ...b, depts, users: [] });
    expect(p.deptRename).toEqual([{ orgId: "o-dev", from: "研发部", to: "研发中心" }]);
    expect(p.deptCreate).toEqual([{ externalId: "fd-qa", name: "测试组", parentExternal: "fd-dev" }]);
    expect(p.deptMissing).toEqual([{ orgId: "o-dev2", name: "旧部门" }]);
  });
});

describe("T40 飞书组织同步：成员", () => {
  it("按邮箱绑定本企业已有账号（大小写不敏感）", () => {
    const p = planSync({ ...base(), depts, users: [user({ id: "ou1", name: "张三", email: "Zhang@acme.com" })] });
    expect(p.userBind).toEqual([{ userId: "u1", name: "张三", externalId: "ou1" }]);
    expect(p.userCreate).toEqual([]);
  });
  it("没有账号：默认跳过，打开选项才新建；没有邮箱不建", () => {
    const users = [user({ id: "ou2", name: "李四", email: "li@acme.com", deptIds: ["fd-qa"] }), user({ id: "ou3", name: "无邮箱" })];
    expect(planSync({ ...base(), depts, users }).skipped).toHaveLength(2);
    const p = planSync({ ...base(), depts, users, options: { createUsers: true, moveUsers: false, deactivate: false } });
    expect(p.userCreate).toEqual([{ externalId: "ou2", name: "李四", email: "li@acme.com", mobile: "", deptExternal: "fd-qa" }]);
    expect(p.skipped[0]).toContain("没有邮箱");
  });
  it("调整部门、停用离职只在打开选项时做，且不动受保护的账号", () => {
    const b = base();
    b.identities.set("ou1", "u1");
    b.identities.set("ouB", "boss");
    const users = [user({ id: "ou1", name: "张三", email: "zhang@acme.com", deptIds: ["fd-dev"] }), user({ id: "ouB", name: "老板", email: "boss@acme.com", resigned: true, deptIds: ["fd-dev"] })];
    const off = planSync({ ...b, depts, users });
    expect(off.userMove).toEqual([]);
    expect(off.userDeactivate).toEqual([]);
    const on = planSync({ ...b, depts, users, options: { createUsers: false, moveUsers: true, deactivate: true } });
    expect(on.userMove).toEqual([{ userId: "u1", name: "张三", deptExternal: "fd-dev" }]);
    expect(on.userDeactivate).toEqual([]);
  });
  it("离职的人：有账号且打开选项才停用，没有账号不新建", () => {
    const b = base();
    b.identities.set("ou1", "u1");
    const users = [user({ id: "ou1", name: "张三", email: "zhang@acme.com", resigned: true }), user({ id: "ou9", name: "离职", email: "x@acme.com", resigned: true })];
    const p = planSync({ ...b, depts, users, options: { createUsers: true, moveUsers: false, deactivate: true } });
    expect(p.userDeactivate).toEqual([{ userId: "u1", name: "张三" }]);
    expect(p.userCreate).toEqual([]);
  });
});
