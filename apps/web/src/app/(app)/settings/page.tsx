import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getSession } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { LogoutButton } from "@/components/settings/LogoutButton";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { ProjectIcon } from "@/components/projects/ProjectIcon";
import { loadAccountPage } from "@pm-collab/core/system/account-page-query";

/** 设置 · 账号（Figma 15）：资料 → 所属项目 → 修改密码 → 退出登录，限宽 800 */
export default async function SettingsPage(props: { searchParams: Promise<{ force?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await getSession();
  if (!user) redirect("/api/auth/logout?next=/login");
  const data = await loadAccountPage(user);
  const force = searchParams?.force === "1" || data.force;
  const { profile, posNames, projects } = data;

  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: force ? (data.hasPassword ? "请修改密码" : "设置密码") : "账号管理", icon: "user" }]} />
      <div className="nv-page-body">
        <div className="nv-set">
          {force ? (
            <div role="alert" className="banner-warning nv-set-notice">
              {data.hasPassword ? "当前账号被要求修改密码，完成前无法访问其他页面。" : "欢迎加入！请先设置登录密码，完成后即可开始使用。"}
            </div>
          ) : (
            <>
              <section className="nv-set-section" aria-labelledby="set-profile">
                <header>
                  <h2 id="set-profile">资料</h2>
                  <p>姓名和头像会显示在指派、评论和动态里。</p>
                </header>
                <ProfileForm
                  name={profile.name}
                  avatarUrl={profile.avatarUrl}
                  account={profile.account}
                  jobRole={profile.jobRole}
                  globalRole={profile.globalRole}
                />
              </section>

              <section className="nv-set-section" aria-labelledby="set-projects">
                <header>
                  <h2 id="set-projects">所属项目</h2>
                  <p>项目内角色优先于全局角色，决定你在该项目里能做什么。</p>
                </header>
                {projects.length ? (
                  <ul className="nv-set-list">
                    {projects.map((m) => (
                      <li key={m.id}>
                        <ProjectIcon name={m.project.name} src={m.project.iconUrl} size={20} />
                        <span className="nv-set-list-name">{m.project.name}</span>
                        <span className="nv-set-list-meta">项目内岗位</span>
                        <span className="nv-tag is-dot is-purple">{m.role === "member" ? "未设置岗位" : posNames[m.role] || m.role}</span>
                        <Link href={`/projects/${m.projectId}`} className="icon-button nv-head-icon" aria-label={`打开项目「${m.project.name}」`} title="打开项目">
                          <ExternalLink size={16} aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-inline">还没有加入任何项目。</p>
                )}
              </section>
            </>
          )}

          <section className="nv-set-section" aria-labelledby="set-pwd">
            <header>
              <h2 id="set-pwd">{data.hasPassword ? "修改密码" : "设置密码"}</h2>
              <p>{data.hasPassword ? "修改后其他设备上的登录会失效，需要重新登录。" : "管理员看不到你的密码；以后忘了可以让管理员发重置链接。"}</p>
            </header>
            <Suspense fallback={<p className="text-sm text-secondary">加载中…</p>}>
              <ChangePasswordForm force={force} hasPassword={data.hasPassword} />
            </Suspense>
          </section>

          <section className="nv-set-logout" aria-label="退出登录">
            <div>
              <p className="nv-set-logout-title">退出登录</p>
              <p className="nv-set-hint">退出当前设备上的账号，未保存的草稿会保留在本机。</p>
            </div>
            <LogoutButton className="btn-secondary nv-head-btn" />
          </section>
        </div>
      </div>
    </div>
  );
}
