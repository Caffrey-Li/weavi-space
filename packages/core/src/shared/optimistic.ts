import { NextResponse } from "next/server";

/**
 * 乐观锁（11-06）：需求、Bug、发版、文档页面、项目、产品有 revision 列，每次更新 +1（src/lib/prisma.ts 的中间件自动加）。
 *
 * 写接口的做法：
 * 1. 读出 existing 后，`const base = baseRevision(body, existing.revision)`；客户端传了 revision 且已过期 → 直接 409。
 * 2. 写库用 `updateMany({ where: { id, revision: base }, data })`，count 为 0 说明读完之后又被别人改了 → 409。
 * 3. 成功后把 `base + 1` 作为新的 revision 返回给客户端，客户端下次保存时带上。
 * 客户端不传 revision 时仍按服务端读到的版本比较，防止同一请求里「读—改—写」之间被并发覆盖。
 */
export const CONFLICT_MESSAGE = "内容已被其他人修改，请刷新后再保存";

export class RevisionConflict extends Error {
  constructor(
    public current?: number,
    message = CONFLICT_MESSAGE,
  ) {
    super(message);
  }
}

export const STATUS_CONFLICT_MESSAGE = "状态刚被其他人改过，请刷新后再试";

/** 请求体里的期望版本号：非负整数才算，其他情况视为没传 */
export function expectedRevision(body: unknown): number | undefined {
  const v = (body as { revision?: unknown } | null)?.revision;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
}

/** 本次写入要比较的版本号；客户端传的版本已过期时抛 RevisionConflict */
export function baseRevision(body: unknown, current: number): number {
  const expected = expectedRevision(body);
  if (expected !== undefined && expected !== current) throw new RevisionConflict(current);
  return current;
}

/** updateMany 的结果：没更新到任何行就是被并发修改了 */
export function assertUpdated(result: { count: number }, current?: number) {
  if (result.count === 0) throw new RevisionConflict(current);
}

export function conflictResponse(e: RevisionConflict) {
  return NextResponse.json({ error: e.message, code: "revision_conflict", revision: e.current }, { status: 409 });
}
