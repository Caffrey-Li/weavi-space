import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { canEditDocs, canViewSpace, ancestorsOf, loadRefInfo } from "./docs-query";
import { extractRefs, renderDocHtml } from "../shared/doc-html";
import { diffDocBodies } from "../shared/doc-diff";
import { casesToHtml } from "../shared/testcases";
export async function historyData(session: SessionUser,id:string,pageId:string,searchParams:{v?:string;view?:string}) {
 const page = await prisma.docPage.findUnique({where:{id:pageId},include:{project:{select:{name:true}},versions:{include:{author:{select:{name:true,avatarUrl:true}}},orderBy:{version:"desc"}}}});
 if (!page || page.projectId!==id || page.deletedAt) return {state:"notFound" as const};
 if (!(await canViewSpace(session,page.projectId))) return {state:"notFound" as const};
 const [ancestors,canEdit,restoreLogs]=await Promise.all([ancestorsOf(page.id),canEditDocs(session,page.projectId),prisma.activityLog.findMany({where:{entityType:"doc",entityId:page.id,action:"restored"},select:{toValue:true}})]);
 const restoredFrom=new Map<number,number>();
 for (const l of restoreLogs) { try { const v=JSON.parse(l.toValue||"{}") as {version?:number;from?:number}; if(v.version&&v.from)restoredFrom.set(v.version,v.from); } catch {} }
 const selected=page.versions.find((v)=>String(v.version)===searchParams.v)||page.versions[0]||null;
 const selectedIndex=selected?page.versions.indexOf(selected):-1; const previous=selectedIndex>=0?page.versions[selectedIndex+1]||null:null;
 // 测试用例页的正文是 JSON：转成一条用例一段再显示 / 对比
 const show=(b:string)=>page.kind==="testcases"?casesToHtml(b):b;
 const diffMode=searchParams.view==="diff"&&Boolean(selected); const rendered=selected&&!diffMode?renderDocHtml(show(selected.body),await loadRefInfo(extractRefs(show(selected.body)),session)):null;
 const diff=selected&&diffMode?diffDocBodies(previous?show(previous.body):"",show(selected.body)):null; const titleChanged=Boolean(selected&&previous&&previous.title!==selected.title);
 return {state:"ok" as const,page,ancestors,canEdit,restoredFrom,selected,previous,diffMode,rendered,diff,titleChanged};
}