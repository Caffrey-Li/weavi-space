import { prisma } from "@pm-collab/db/prisma";

/** 默认分组：每个空间首次打开时自动创建；未分组的根页面归到「业务文档」（key 仍为 project，兼容旧数据） */
export const DEFAULT_DOC_GROUPS = [
  { key: "product", name: "产品文档" },
  { key: "dev", name: "开发文档" },
  { key: "project", name: "业务文档" },
] as const;
export const FALLBACK_GROUP_KEY = "project";

export type DocGroupRow = { id: string; key: string | null; name: string; sortOrder: number };

const creating = new Map<string, Promise<void>>();

/** 空间的分组（缺默认分组时补上），按顺序返回；同一默认分组有重复（早期并发创建）时只保留第一个 */
export async function listDocGroups(projectId: string): Promise<DocGroupRow[]> {
  return (await listDocGroupsWithAliases(projectId)).groups;
}

/** 同上，另外返回重复默认分组 → 保留分组 的对应，供页面树把挂在重复分组下的页面归回去 */
export async function listDocGroupsWithAliases(projectId: string): Promise<{ groups: DocGroupRow[]; aliases: Map<string, string> }> {
  const select = { id: true, key: true, name: true, sortOrder: true } as const;
  const read = () => prisma.docGroup.findMany({ where: { projectId }, select, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  let rows = await read();
  if (!rows.some((r) => r.key)) {
    // 只在空间从没建过默认分组时补齐（被删过的默认分组不再自动回来）；同一进程内并发请求共用一次创建
    let job = creating.get(projectId);
    if (!job) {
      job = (async () => {
        const again = await read();
        if (again.some((r) => r.key)) return;
        for (const d of DEFAULT_DOC_GROUPS) {
          await prisma.docGroup.create({ data: { projectId, key: d.key, name: d.name, sortOrder: DEFAULT_DOC_GROUPS.findIndex((x) => x.key === d.key) } });
        }
      })().finally(() => creating.delete(projectId));
      creating.set(projectId, job);
    }
    await job;
    rows = await read();
  }
  const aliases = new Map<string, string>();
  const keep = new Map<string, string>();
  const groups: DocGroupRow[] = [];
  for (const r of rows) {
    if (r.key) {
      const first = keep.get(r.key);
      if (first) {
        aliases.set(r.id, first);
        continue;
      }
      keep.set(r.key, r.id);
    }
    // 旧数据里默认分组名还是「项目文档」：只在显示时换成「业务文档」，不改库里的数据；用户自己改过名的保持不变
    groups.push(r.key === "project" && r.name === "项目文档" ? { ...r, name: "业务文档" } : r);
  }
  return { groups, aliases };
}

/** 根页面没有分组、或分组已被删时落到的分组：优先「业务文档」，否则最后一个 */
export function fallbackGroupId(groups: DocGroupRow[]): string | null {
  return groups.find((g) => g.key === FALLBACK_GROUP_KEY)?.id || groups[groups.length - 1]?.id || null;
}
