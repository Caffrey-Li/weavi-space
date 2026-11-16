/** MCP 工具 → 开放接口 v1 的映射：权限、数据范围、令牌 scope 全部沿用 v1（等于用这个人的身份调用） */
type Schema = { type: "object"; properties: Record<string, unknown>; required?: string[] };
export type V1Call = { method: "GET" | "POST" | "PATCH"; path: string[]; query?: Record<string, unknown>; body?: unknown };
export type ToolDef = { name: string; description: string; inputSchema: Schema; v1?: (a: Record<string, unknown>) => V1Call };

const str = (description: string) => ({ type: "string", description });
const page = { page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 } };
const id = (a: Record<string, unknown>) => String(a.id || "");
const omit = (a: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(a).filter(([k]) => !keys.includes(k)));

export const TOOLS: ToolDef[] = [
  { name: "list_projects", description: "列出我能看到的项目", inputSchema: { type: "object", properties: { ...page } }, v1: (a) => ({ method: "GET", path: ["projects"], query: a }) },
  { name: "list_requirements", description: "列出我能看到的需求，可按项目和状态筛选", inputSchema: { type: "object", properties: { projectId: str("项目 id"), status: str("状态 key，如 dev_in_progress"), ...page } }, v1: (a) => ({ method: "GET", path: ["requirements"], query: a }) },
  { name: "get_requirement", description: "读取一条需求详情", inputSchema: { type: "object", properties: { id: str("需求 id") }, required: ["id"] }, v1: (a) => ({ method: "GET", path: ["requirements", id(a)] }) },
  { name: "create_requirement", description: "新建需求（需要账号有新建需求权限，令牌有 requirements.create）", inputSchema: { type: "object", properties: { title: str("标题"), projectId: str("项目 id，不填进公共需求池"), priority: str("p0～p3"), descriptionHtml: str("描述（HTML）") }, required: ["title"] }, v1: (a) => ({ method: "POST", path: ["requirements"], body: a }) },
  { name: "update_requirement", description: "修改需求的标题、优先级、描述、计划日期等", inputSchema: { type: "object", properties: { id: str("需求 id"), title: str("标题"), priority: str("p0～p3"), descriptionHtml: str("描述（HTML）"), plannedEndAt: str("计划完成 YYYY-MM-DD"), revision: { type: "integer", description: "版本号（读详情时拿到），防止覆盖别人的修改" } }, required: ["id"] }, v1: (a) => ({ method: "PATCH", path: ["requirements", id(a)], body: omit(a, "id") }) },
  { name: "update_requirement_status", description: "修改需求状态", inputSchema: { type: "object", properties: { id: str("需求 id"), status: str("状态 key") }, required: ["id", "status"] }, v1: (a) => ({ method: "PATCH", path: ["requirements", id(a), "status"], body: { status: a.status } }) },
  { name: "comment_requirement", description: "给需求写评论", inputSchema: { type: "object", properties: { id: str("需求 id"), bodyHtml: str("评论内容（HTML）") }, required: ["id", "bodyHtml"] }, v1: (a) => ({ method: "POST", path: ["requirements", id(a), "comments"], body: omit(a, "id") }) },
  { name: "list_bugs", description: "列出我能看到的 Bug", inputSchema: { type: "object", properties: { projectId: str("项目 id"), status: str("状态 key"), ...page } }, v1: (a) => ({ method: "GET", path: ["bugs"], query: a }) },
  { name: "get_bug", description: "读取一个 Bug 详情", inputSchema: { type: "object", properties: { id: str("Bug id") }, required: ["id"] }, v1: (a) => ({ method: "GET", path: ["bugs", id(a)] }) },
  { name: "create_bug", description: "新建 Bug（需要处理 Bug 的权限）", inputSchema: { type: "object", properties: { title: str("标题"), projectId: str("项目 id"), severity: str("blocker|critical|major|minor|trivial"), descriptionHtml: str("描述（HTML）") }, required: ["title", "projectId"] }, v1: (a) => ({ method: "POST", path: ["bugs"], body: a }) },
  { name: "update_bug_status", description: "修改 Bug 状态", inputSchema: { type: "object", properties: { id: str("Bug id"), status: str("open|in_progress|resolved|closed|reopened|cancelled") }, required: ["id", "status"] }, v1: (a) => ({ method: "PATCH", path: ["bugs", id(a), "status"], body: { status: a.status } }) },
  { name: "list_releases", description: "列出我能看到的发版", inputSchema: { type: "object", properties: { projectId: str("项目 id"), ...page } }, v1: (a) => ({ method: "GET", path: ["releases"], query: a }) },
  { name: "list_products", description: "列出我能看到的产品", inputSchema: { type: "object", properties: { ...page } }, v1: (a) => ({ method: "GET", path: ["products"], query: a }) },
  { name: "list_doc_spaces", description: "列出我能看到的文档空间", inputSchema: { type: "object", properties: { ...page } }, v1: (a) => ({ method: "GET", path: ["docs", "spaces"], query: a }) },
  { name: "get_doc_page", description: "读取一篇文档", inputSchema: { type: "object", properties: { id: str("文档页面 id") }, required: ["id"] }, v1: (a) => ({ method: "GET", path: ["docs", "pages", id(a)] }) },
  { name: "delivery_list_test_runs", description: "需求交付：列出等我在本机执行的测试轮次（发起时选了「我的电脑」）", inputSchema: { type: "object", properties: {} } },
  { name: "delivery_get_test_run", description: "需求交付：领取并读取一轮测试——测试环境地址、测试账号（密码只给发起人）、每条用例的结构化步骤和预期", inputSchema: { type: "object", properties: { runId: str("轮次 id") }, required: ["runId"] } },
  { name: "delivery_report_test_result", description: "需求交付：回传一条用例的执行结果；失败时写清现象、出错步骤，可附 PNG / JPEG 截图（base64，≤ 5 MB）", inputSchema: { type: "object", properties: { runId: str("轮次 id"), code: str("用例编号，如 TC-03"), status: str("passed | failed | blocked | skipped"), message: str("失败或阻塞的现象"), failedStep: { type: "integer", minimum: 1, description: "出错的步骤序号" }, durationMs: { type: "integer", minimum: 0 }, screenshotBase64: str("截图（base64，可选）") }, required: ["runId", "code", "status"] } },
  { name: "delivery_finish_test_run", description: "需求交付：本机执行结束；之后由人在面板里填剩下的手工用例并点「完成本轮」（提 Bug、写测试记录）", inputSchema: { type: "object", properties: { runId: str("轮次 id") }, required: ["runId"] } },
  { name: "get_skill_file", description: "读取系统内置 skill（caffrey-prd-plus、caffrey-test-runner）的原文：不给 path 读 SKILL.md 并列出全部文件；在本机执行需求交付测试前先读 caffrey-test-runner 的 SKILL.md 和 references/weavi-delivery.md", inputSchema: { type: "object", properties: { skill: str("caffrey-prd-plus 或 caffrey-test-runner"), path: str("文件路径，如 references/weavi-delivery.md，默认 SKILL.md") }, required: ["skill"] } },
  { name: "weavi_connection_test", description: "连通测试：在小围空间「设置 › 本机 Agent」里点「测试连接」后，用页面上显示的测试码调用一次，确认这个 Agent 已经接好", inputSchema: { type: "object", properties: { code: str("设置页里显示的 6 位测试码") }, required: ["code"] } },
  { name: "list_skills", description: "列出我的个人能力（需求分析、PRD、原型图、测试用例、测试报告，以及我上传的 skill）和可用模型", inputSchema: { type: "object", properties: {} } },
  { name: "run_skill", description: "用我的模型执行一项个人能力；给 spaceId 时把结果存成该空间的一篇文档", inputSchema: { type: "object", properties: { skillId: str("能力 id，如 builtin:prd"), input: str("输入内容"), credentialId: str("模型凭据 id（list_skills 返回）"), model: str("模型名"), spaceId: str("可选：存到哪个文档空间") }, required: ["skillId", "input", "credentialId", "model"] } },
];
