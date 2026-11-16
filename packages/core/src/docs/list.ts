import type { SessionUser } from "../auth";
import { result, type DocAccess } from "./result";
import { flattenSpaces, loadSpaceTree } from "./doc-spaces-query";
import { typedDocs, type DocType } from "./doc-stats-query";
import { pageDisplayTitle } from "./docs-query";

export const dynamic = "force-dynamic";

/** 文档层级：按类型列出当前用户可见的全部文档（侧栏「文档」视图展开时用） */
export async function GET(session: SessionUser, input: DocAccess = { url: "", body: null }) {
  const type = new URL(input.url).searchParams.get("type") as DocType | null;
  const spaces = flattenSpaces(await loadSpaceTree(session, { counts: false }));
  const ref = new Map(spaces.map((s) => [s.spaceId, s]));
  const rows = (await typedDocs(spaces.map((s) => s.spaceId)))
    .filter((r) => !type || r.type === type)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 200);
  return result({
    rows: rows.map((r) => {
      const s = ref.get(r.spaceId)!;
      return { id: r.id, spaceId: r.spaceId, title: pageDisplayTitle(r), group: r.groupName, type: r.type, spaceName: s.name, level: s.level, productName: s.productName };
    }),
  });
}
