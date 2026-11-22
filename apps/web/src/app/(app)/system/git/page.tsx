import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { GitConnectionsPanel } from "@/components/git/GitConnectionsPanel";

export const dynamic = "force-dynamic";

/** 系统设置 · 代码仓库（T44，Figma 90A）：GitLab 连接（gitlab.com / 自建） */
export default async function GitSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "代码仓库", icon: "git" }]} />
      <div className="nv-page-body">
        <div className="nv-set">
          <header className="nv-set-title">
            <h1>代码仓库</h1>
            <p>连接 GitLab（gitlab.com 或公司自建），再到项目概览「代码仓库」里绑定具体仓库。分支名、提交说明、MR 标题里写上需求编号（如 R1042）或任务编号（如 T1562）就会自动关联：推送后任务进入进行中，MR 合并后开发任务完成，打标签后对应发版上线。令牌只存密文，界面只显示后四位。</p>
          </header>
          <GitConnectionsPanel />
        </div>
      </div>
    </div>
  );
}
