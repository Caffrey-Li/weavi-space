import { PrismaClient } from "@prisma/client";
import { bumpRevision } from "@/lib/revision-bump";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

// PostgreSQL（DATABASE_URL）。不再支持 SQLite / Turso / 随包演示库。
function createPrisma() {
  const log: ("error" | "warn")[] = process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];
  return new PrismaClient({ log });
}

/** 写入动态后异步推送个人机器人通知（src/lib/notify.ts）；失败只记日志，不影响业务写入 */
/**
 * 回收站 / 归档的默认过滤：查询这些表时自动排除已删除（deletedAt）的记录；文档页面还排除已归档的。
 * 查询条件里自己写了 deletedAt / archivedAt 的（回收站、已归档列表、恢复）不会被改动。findUnique 不受影响，详情页自行判断。
 */
const SOFT_MODELS: Record<string, string[]> = {
  Project: ["deletedAt"],
  Product: ["deletedAt"],
  Requirement: ["deletedAt"],
  Bug: ["deletedAt"],
  DocPage: ["deletedAt", "archivedAt"],
};
const SOFT_ACTIONS = new Set(["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy"]);

function withNotify(client: PrismaClient) {
  client.$use(async (params, next) => {
    if (params.model && params.args) bumpRevision(params.model, params.action, params.args as Record<string, unknown>);
    return next(params);
  });
  client.$use(async (params, next) => {
    const fields = params.model ? SOFT_MODELS[params.model] : undefined;
    if (fields && SOFT_ACTIONS.has(params.action)) {
      params.args = params.args || {};
      const where = params.args.where;
      const text = where ? JSON.stringify(where) : "";
      const add = fields.filter((f) => !text.includes(`"${f}"`)).map((f) => ({ [f]: null }));
      if (add.length) params.args.where = where ? { AND: [where, ...add] } : add.length === 1 ? add[0] : { AND: add };
    }
    return next(params);
  });
  client.$use(async (params, next) => {
    const result = await next(params);
    if (params.model === "ActivityLog" && params.action === "create" && result) {
      import("@/lib/notify")
        .then((m) => m.notifyActivity(result as Parameters<typeof m.notifyActivity>[0]))
        .catch((e) => console.error("[通知] 处理失败", e));
    }
    return result;
  });
  return client;
}

export const prisma = globalForPrisma.prisma || withNotify(createPrisma());

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
