import { notFound, redirect } from "next/navigation";
import { findProjectLayout } from "@pm-collab/core/projects/layout-query";
import { getSession } from "@/lib/auth";
import { canSeeProject } from "@/lib/access";

/** 项目内所有页面：项目不在当前角色的数据范围内时按不存在处理 */
export default async function ProjectScopeLayout(props: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const params = await props.params;

  const {
    children
  } = props;

  const session = await getSession();
  if (!session || !(await canSeeProject(session, params.id))) notFound();
  // 产品资料空间不是真正的项目，只在文档里出现
  const p = await findProjectLayout(params.id);
  // 回收站里的项目按不存在处理
  if (!p || p.deletedAt) notFound();
  if (p?.status === "space") redirect(`/docs/${params.id}`);
  return <>{children}</>;
}
