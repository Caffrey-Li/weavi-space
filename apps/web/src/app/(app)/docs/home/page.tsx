import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { docsHomeSpace } from "@pm-collab/core/docs/home-query";

/** 文档 · 主页：进入自己参与的第一个空间（没有则去「所有空间」） */
export default async function DocsHome() {
  const session = await getSession();
  if (!session) redirect("/api/auth/logout?next=/login");
  const first = await docsHomeSpace(session);
  redirect(first ? `/docs/${first.id}` : "/docs");
}
