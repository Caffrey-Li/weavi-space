import type { SessionUser } from "../auth";
import { result } from "./result";
import { loadSpaceTree } from "./doc-spaces-query";

/** 文档侧栏的空间树：产品（含产品资料空间）› 项目空间；没有产品的项目在「未归属产品」下 */
export async function GET(session: SessionUser) {
  return result(await loadSpaceTree(session));
}
