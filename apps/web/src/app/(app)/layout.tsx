import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/constants";
import { loadAppLayoutData } from "@pm-collab/core/workbench/layout-query";
import { AppShell } from "@/components/layout/AppShell";
import { DemoExitButton } from "@/components/layout/DemoExitButton";
import type { Metadata } from "next";
import { getSystemSettings } from "@/lib/system-settings";
import { enterpriseAdminOf } from "@pm-collab/core/shared/enterprise-admin";

/** 浏览器标签页标题跟随「设置 · 常规」里的系统名称 */
export async function generateMetadata(): Promise<Metadata> {
  const s = await getSystemSettings();
  return { title: `${s.name} · 产品研发协同` };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  // 令牌还在但服务端已判定失效：先清 Cookie 再回登录页
  if (!user) redirect("/api/auth/logout?next=/login");
  const { allRequirements, myRequirements, myBugs, projects, canCreate, canCreateBug, canManageProducts, productNav, system, roles, positions, flows } = await loadAppLayoutData(user);
  const isEntAdmin = user.globalRole !== "admin" && Boolean(await enterpriseAdminOf(user.id));
  return (
    <AppShell
      counts={{ allRequirements, myRequirements, myBugs }}
      projects={projects}
      canCreate={canCreate}
      canCreateBug={canCreateBug}
      canManageProducts={canManageProducts}
      productNav={productNav}
      system={{ name: system.name, logo: system.logo, weekStart: system.weekStart }}
      // 现状：成员管理、角色权限对所有登录用户只读可见，编辑仍由 users.manage 控制
      canManageOrg
      roleLabel={roles.find((r) => r.key === user.globalRole)?.name || ROLE_LABELS[user.globalRole] || user.globalRole}
      labels={{ roles: roles.map((r) => ({ key: r.key, name: r.name })), positions: positions.map((p) => ({ key: p.key, name: p.name })) }}
      isAdmin={user.globalRole === "admin"}
      isEntAdmin={isEntAdmin}
      flows={flows}
    >
      {user.isDemo || user.demoKind === "editable" ? (
        <p className="wv-demo-banner" role="status">
          {user.isDemo ? "你正在以访客身份体验：页面里都是演示数据，只能查看，不能新建或修改。" : "你正在用体验账号：页面里都是虚构的演示数据，可以随意新建和修改，管理员重置演示数据时会清掉这些改动。"}
          <DemoExitButton />
        </p>
      ) : null}
      {children}
    </AppShell>
  );
}
