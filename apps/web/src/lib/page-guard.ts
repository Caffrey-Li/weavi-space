import { notFound } from "next/navigation";
import { getSession } from "./auth";
import { canSeeProject } from "./access";

/** 项目内页面第一行调用：不在数据范围内按不存在处理。布局挡不住并行渲染的页面，所以每个页面都要自己调 */
export async function requireProjectPage(projectId: string) {
  const session = await getSession();
  if (!session || !(await canSeeProject(session, projectId))) notFound();
  return session;
}
