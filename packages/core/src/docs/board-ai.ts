import type { SessionUser } from "../auth";
import { prisma } from "@pm-collab/db/prisma";
import { result } from "../nova/result";
import { chatOnce } from "../ai/providers";
import { credentialForUse } from "../ai/credentials";
import { recordUsage } from "../ai/quota";
import { canEditDocs, canViewSpace } from "./docs-query";

/**
 * 画布「让小围画」：按一句描述生成 Mermaid 流程图代码，前端再转成画布图形。
 * 用调用人自己选的模型（企业模型计入定额），只返回代码，不落库。
 */
const SYSTEM = [
  "你把用户的描述转换成 Mermaid 图表代码，只输出代码本身，不要解释，不要 ``` 包裹。",
  "优先用 flowchart（流程、审批、系统调用关系）；时序用 sequenceDiagram；类和实体关系用 classDiagram。",
  "flowchart 用 LR 或 TD；节点文字用中文、简短；开始 / 结束用 ([文字])，判断用 {文字}，步骤用 [文字]；连线上的条件写成 -- 条件 -->。",
  "节点 id 只用英文字母和数字。最多 40 个节点。",
].join("\n");

export function cleanMermaid(text: string): string {
  const m = text.match(/```(?:mermaid)?\s*([\s\S]*?)```/);
  return (m ? m[1] : text).trim().slice(0, 8000);
}

export async function boardAi(session: SessionUser, body: Record<string, unknown>) {
  const prompt = String(body.prompt || "").trim().slice(0, 2000);
  const pageId = String(body.pageId || "");
  if (!prompt) return result({ error: "请先描述要画什么" }, { status: 400 });
  const page = pageId ? await prisma.docPage.findUnique({ where: { id: pageId }, select: { projectId: true, kind: true } }) : null;
  if (!page || page.kind !== "board") return result({ error: "画布不存在" }, { status: 404 });
  if (!(await canViewSpace(session, page.projectId)) || !(await canEditDocs(session, page.projectId))) return result({ error: "无权编辑这个画布" }, { status: 403 });
  const credentialId = String(body.credentialId || "");
  const model = String(body.model || "");
  if (!credentialId || !model) return result({ error: "请先选择模型（设置 · 个人 · 模型管理）" }, { status: 400 });
  const use = await credentialForUse(session, credentialId, model);
  if ("error" in use) return result({ error: use.error }, { status: 402 });
  let out;
  try {
    out = await chatOnce(use.cred, model, SYSTEM, [{ role: "user", content: prompt }]);
  } catch (e) {
    return result({ error: `模型调用失败：${(e as Error).message}` }, { status: 502 });
  }
  await recordUsage({ userId: session.id, enterpriseId: use.enterpriseId, credentialId: use.credentialId, billedTo: use.billedTo, provider: use.cred.provider, model, feature: "board", inputTokens: out.inputTokens, outputTokens: out.outputTokens });
  const mermaid = cleanMermaid(out.text);
  if (!mermaid) return result({ error: "模型没有返回图表代码，换个说法再试" }, { status: 502 });
  return result({ mermaid });
}
