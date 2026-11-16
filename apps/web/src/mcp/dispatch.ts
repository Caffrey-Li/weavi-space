import type { ApiTokenPrincipal } from "@pm-collab/core/api-tokens";
import { API_SCOPES } from "@pm-collab/core/api-tokens/scopes";
import type { SessionUser } from "@pm-collab/core/auth";
import { builtinSkillFile, builtinSkillIndex, listSkills, refreshSkillPacks, runSkill } from "@pm-collab/core/skills/service";
import { availableModels } from "@pm-collab/core/ai/credentials";
import { finishLocalRun, getLocalRun, listLocalRuns, reportLocalResult } from "@pm-collab/core/delivery/service";
import { v1Read, v1Write } from "@/lib/open-api-v1";
import { TOOLS, type V1Call } from "./tools";

/**
 * 执行一个工具：MCP（令牌身份，带 apiTokenScopes）和系统内 Agent（登录用户本人）共用。
 * 数据工具走开放接口 v1 的同一套处理，权限、数据范围、令牌 scope 都和这个人一致。
 */
export type ToolResult = { ok: boolean; data: unknown };

async function viaV1(user: SessionUser, spec: V1Call): Promise<ToolResult> {
  // 令牌身份自带 scope；系统内 Agent 用登录用户，等同一个拥有全部 scope 的令牌（写操作仍要账号本身有对应功能权限）
  const principal = { tokenId: "in-process", user: user.apiTokenScopes ? user : { ...user, apiTokenScopes: API_SCOPES } } as unknown as ApiTokenPrincipal;
  const path = spec.path.map(String);
  let res;
  if (spec.method === "GET") {
    const url = new URL(`http://localhost/api/v1/${path.map(encodeURIComponent).join("/")}`);
    for (const [k, v] of Object.entries(spec.query || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    res = await v1Read(principal, path, url);
  } else res = await v1Write(principal, spec.method, path, spec.body ?? {});
  const data = await res.json().catch(() => ({}));
  return { ok: res.status < 400, data };
}

export async function callTool(user: SessionUser, name: string, args: Record<string, unknown>): Promise<ToolResult | null> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  // 连通测试要知道令牌是哪张，只在 MCP 路由里处理
  if (name === "weavi_connection_test") return { ok: false, data: { error: "这个工具只能由本机 Agent 通过 MCP 调用" } };
  try {
    if (tool.v1) return await viaV1(user, tool.v1(args));
    if (name === "get_skill_file") {
      const skill = String(args.skill || "");
      await refreshSkillPacks();
      const index = builtinSkillIndex();
      if (!index[skill]) return { ok: false, data: { error: `没有这个内置 skill，可选：${Object.keys(index).join("、")}` } };
      const path = String(args.path || "SKILL.md");
      const body = builtinSkillFile(skill, path);
      if (body === null) return { ok: false, data: { error: `没有这个文件：${path}`, files: index[skill].files } };
      return { ok: true, data: path === "SKILL.md" ? `<!-- ${skill} v${index[skill].version}，全部文件：${index[skill].files.join("、")} -->\n${body}` : body };
    }
    if (name.startsWith("delivery_")) {
      const data =
        name === "delivery_list_test_runs" ? await listLocalRuns(user) : name === "delivery_get_test_run" ? await getLocalRun(user, args.runId) : name === "delivery_report_test_result" ? await reportLocalResult(user, args) : await finishLocalRun(user, args.runId);
      return { ok: true, data };
    }
    if (name === "list_skills") {
      const [skills, models] = await Promise.all([listSkills(user), availableModels(user)]);
      return { ok: true, data: { skills: skills.body, models: models.options.filter((o) => !o.disabled).map(({ credentialId, model, source }) => ({ credentialId, model, source })) } };
    }
    const r = await runSkill(user, args);
    return { ok: !(r.init && r.init.status >= 400), data: r.body };
  } catch (e) {
    return { ok: false, data: { error: (e as Error).message || "执行失败" } };
  }
}
