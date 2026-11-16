import type { SessionUser } from "../auth";
import { can } from "../permissions";
import { flattenSpaces, loadSpaceTree } from "./doc-spaces-query";
import { typedDocs } from "./doc-stats-query";
export async function docsData(user: SessionUser) {
 const tree=await loadSpaceTree(user); const spaces=flattenSpaces(tree);
 const [all,canCreate]=await Promise.all([typedDocs(spaces.map((s)=>s.spaceId)),can(user,"project.edit")]);
 all.sort((a,b)=>b.updatedAt.getTime()-a.updatedAt.getTime());
 return {tree,spaces,ref:new Map(spaces.map((s)=>[s.spaceId,s])),all,canCreate};
}