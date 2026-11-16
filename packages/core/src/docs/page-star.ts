import type { SessionUser } from "../auth";
import { result } from "./result";
import { prisma } from "@pm-collab/db/prisma";
import { pageForWrite } from "../shared/docs-api";

/** 加星标 / 取消星标：能看到页面就能加星标 */
export async function POST(session: SessionUser, params: { id: string }) {
  const found = await pageForWrite(session, params.id, false);
  if ("error" in found) return found.error;
  await prisma.docPageStar.upsert({
    where: { pageId_userId: { pageId: params.id, userId: session.id } },
    create: { pageId: params.id, userId: session.id },
    update: {},
  });
  return result({ starred: true });
}

export async function DELETE(session: SessionUser, params: { id: string }) {
  const found = await pageForWrite(session, params.id, false);
  if ("error" in found) return found.error;
  await prisma.docPageStar.deleteMany({ where: { pageId: params.id, userId: session.id } });
  return result({ starred: false });
}
