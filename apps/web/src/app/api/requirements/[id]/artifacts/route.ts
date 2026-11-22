import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createArtifact, listArtifacts, uploadArtifact } from "@pm-collab/core/requirements/artifacts";

export const dynamic = "force-dynamic";

/** 需求资料（T42）：UI 设计 / 原型 / 需求文档 / 测试用例 / 测试报告 / 其他 */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const list = await listArtifacts(s, (await props.params).id);
  return list ? NextResponse.json(list) : NextResponse.json({ error: "需求不存在" }, { status: 404 });
}

/** JSON { kind, source: link | doc, url | docPageId, title?, note?, shareToChildren? }；multipart（file、kind、title、note、shareToChildren）上传文件 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await props.params;
  try {
    if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
      const r = await uploadArtifact(s, id, await req.formData());
      return NextResponse.json(r.body, r.init);
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const r = await createArtifact(s, id, body);
    return NextResponse.json(r.body, r.init);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "保存失败，请稍后重试" }, { status: 500 });
  }
}
