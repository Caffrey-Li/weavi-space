import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { buildDemo, deleteDemo, demoStatus } from "@pm-collab/core/demo/service";
import { oneClickOn, setOneClick } from "@pm-collab/core/demo/guests";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 演示体验（系统超管）：GET 演示组织状态；POST { action: build | delete | oneclick, on? } */
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (s.globalRole !== "admin") return NextResponse.json({ error: "只有系统超管可以操作" }, { status: 403 });
  return NextResponse.json({ ...(await demoStatus()), oneClick: await oneClickOn() });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  const r =
    action === "build"
      ? await buildDemo(s)
      : action === "delete"
        ? await deleteDemo(s)
        : action === "oneclick"
          ? await setOneClick(s, body.on === true)
          : { error: "不支持的操作", status: 400 };
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
