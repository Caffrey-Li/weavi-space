import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { enterpriseAdminOf } from "@pm-collab/core/shared/enterprise-admin";
import { WorkHeader } from "@/components/layout/WorkHeader";
import { AiImageForm } from "@/components/settings/AiImageForm";

export const dynamic = "force-dynamic";

/** 系统设置 · AI 生图（Figma 41）：OpenAI 兼容的图片生成接口，API Key 加密保存 */
export default async function AiImagePage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  if (session.globalRole !== "admin" && !(await enterpriseAdminOf(session.id))) redirect("/system/general");
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "AI 生图", icon: "sparkles" }]} />
      <div className="nv-page-body">
        <div className="nv-set nv-ftab">
          <header className="nv-set-title">
            <h1>AI 生图</h1>
            <p>每个企业单独配置：配置后，本企业的项目编辑时可以用「AI 生成」按名称和描述生成背景图和图标，按张数和单价核算费用。支持 OpenAI 兼容的图片生成接口，如火山方舟豆包 Seedream。</p>
          </header>
          <AiImageForm />
        </div>
      </div>
    </div>
  );
}
