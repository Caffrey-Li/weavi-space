import { describe, expect, it } from "vitest";
import { groupInbox, mergeInbox, pickButtons, pickKpis, rolesFor, type InboxItem, type WbKpi } from "@pm-collab/core/workbench/roles";

const item = (p: Partial<InboxItem> & Pick<InboxItem, "key" | "role" | "urgency">): InboxItem => ({ kind: "k", title: p.key, meta: "", href: "/", action: "看", ...p });
const kpi = (role: WbKpi["role"], label: string, danger = false): WbKpi => ({ role, label, value: 1, note: "", href: "/", danger });

describe("工作台角色（11-22）", () => {
  it("角色 = 默认岗位 + 项目内岗位 + 角色，按流程顺序", () => {
    expect(rolesFor("member", "pm", ["product", "frontend", "backend"])).toEqual(["product", "dev", "pm"]);
    expect(rolesFor("admin", null, [])).toEqual(["admin"]);
    expect(rolesFor("manager", "designer", ["business"])).toEqual(["business", "designer", "manager"]);
    expect(rolesFor("member", null, [])).toEqual(["dev"]);
    expect(rolesFor("member", "custom_x", [])).toEqual(["dev"]);
  });
  it("待我处理：先按紧急程度，同级按流程顺序；同一件事只出现一次，留靠前的角色", () => {
    const out = mergeInbox([
      item({ key: "a", role: "pm", urgency: 2 }),
      item({ key: "b", role: "product", urgency: 2 }),
      item({ key: "c", role: "pm", urgency: 0 }),
      item({ key: "b", role: "qa", urgency: 2 }),
      item({ key: "d", role: "business", urgency: 3 }),
    ]);
    expect(out.map((x) => `${x.key}:${x.role}`)).toEqual(["c:pm", "b:product", "a:pm", "d:business"]);
    expect(groupInbox(out).map((g) => [g.urgency, g.items.length])).toEqual([[0, 1], [2, 2], [3, 1]]);
  });
  it("指标：单角色用自己的 4 个；多角色每个先出 1 个，红色优先，最多 4 个", () => {
    const one = pickKpis([{ role: "dev", kpis: [kpi("dev", "1"), kpi("dev", "2"), kpi("dev", "3"), kpi("dev", "4"), kpi("dev", "5")] }]);
    expect(one.map((k) => k.label)).toEqual(["1", "2", "3", "4"]);
    const two = pickKpis([
      { role: "pm", kpis: [kpi("pm", "项目"), kpi("pm", "逾期", true), kpi("pm", "Bug", true)] },
      { role: "product", kpis: [kpi("product", "待梳理"), kpi("product", "评审中")] },
    ]);
    expect(two.map((k) => k.label)).toEqual(["待梳理", "评审中", "逾期", "项目"]);
    const many = pickKpis(
      (["business", "product", "designer", "dev", "qa"] as const).map((r) => ({ role: r, kpis: [kpi(r, r, r === "qa")] })),
    );
    expect(many.map((k) => k.label)).toEqual(["business", "product", "designer", "qa"]);
  });
  it("按钮取流程最靠前、有按钮的角色", () => {
    expect(pickButtons([{ role: "pm", buttons: [{ label: "写周报", href: "/" }] }, { role: "dev", buttons: [] }, { role: "product", buttons: [{ label: "新建需求", href: "/" }] }]).map((b) => b.label)).toEqual(["新建需求"]);
  });
});
