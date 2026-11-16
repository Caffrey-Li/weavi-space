/**
 * 本机 Agent 接入（T28）：各家 Agent 的 MCP 配置写法。纯函数，前后端共用。
 * 写法按各家公开文档整理；是否真的可用以「测试连接」为准（Agent 用测试码调一次 weavi_connection_test 才算连通）。
 * 只支持本地命令方式的 Agent 用 mcp-remote 把 HTTP 转成命令（需要电脑上有 Node.js）。
 */
export const SERVER_NAME = "weavi-space";
export const TEST_TOOL = "weavi_connection_test";

export type AgentPreset = {
  key: string;
  label: string;
  /** 配置写在哪里 / 怎么执行 */
  where: string;
  /** 代码块语言（复制时不影响） */
  lang: "json" | "toml" | "bash";
  build: (mcpUrl: string, token: string) => string;
  /** 补充步骤 */
  tips: string[];
};

const json = (v: unknown) => JSON.stringify(v, null, 2);
const httpEntry = (key: string, extra: Record<string, unknown> = {}) => (url: string, token: string) =>
  json({ mcpServers: { [SERVER_NAME]: { ...extra, [key]: url, headers: { Authorization: `Bearer ${token}` } } } });
const bridgeArgs = (url: string, token: string) => ["-y", "mcp-remote", url, "--allow-http", "--header", `Authorization:Bearer ${token}`];

export const AGENT_PRESETS: AgentPreset[] = [
  {
    key: "claude_code",
    label: "Claude Code",
    where: "在终端执行下面这条命令（只需一次）",
    lang: "bash",
    build: (url, token) => `claude mcp add --transport http ${SERVER_NAME} ${url} --header "Authorization: Bearer ${token}"`,
    tips: ["执行后用 claude mcp list 确认 weavi-space 显示已连接", "已经在运行的 Claude Code 要退出重开"],
  },
  {
    key: "cursor",
    label: "Cursor",
    where: "~/.cursor/mcp.json（没有就新建；已有 mcpServers 时只合并 weavi-space 这一项）",
    lang: "json",
    build: httpEntry("url"),
    tips: ["保存后到 Cursor 设置 › MCP 确认 weavi-space 是绿色"],
  },
  {
    key: "antigravity",
    label: "Antigravity",
    where: "Antigravity 右上角 … › MCP Servers › Manage MCP Servers › View raw config（mcp_config.json）",
    lang: "json",
    build: httpEntry("serverUrl"),
    tips: ["保存后点 Refresh，weavi-space 下面能看到工具列表就是读到了"],
  },
  {
    key: "codebuddy",
    label: "CodeBuddy / WorkBuddy",
    where: "~/.codebuddy/.mcp.json（或项目根目录的 .mcp.json）",
    lang: "json",
    build: httpEntry("url", { type: "http" }),
    tips: ["保存后重启，/mcp 里能看到 weavi-space"],
  },
  {
    key: "codex",
    label: "Codex",
    where: "~/.codex/config.toml（通过 mcp-remote 转接，需要电脑上有 Node.js）",
    lang: "toml",
    build: (url, token) => `[mcp_servers.${SERVER_NAME}]\ncommand = "npx"\nargs = ${JSON.stringify(bridgeArgs(url, token))}`,
    tips: ["保存后重开 Codex，/mcp 里能看到 weavi-space"],
  },
  {
    key: "gemini_cli",
    label: "Gemini CLI",
    where: "~/.gemini/settings.json",
    lang: "json",
    build: httpEntry("httpUrl"),
    tips: ["保存后重开，/mcp 里能看到 weavi-space"],
  },
  {
    key: "deepseek_harness",
    label: "DeepSeek Harness",
    where: "DeepSeek Harness 的 MCP 配置（命令方式，通过 mcp-remote 转接，需要电脑上有 Node.js）",
    lang: "json",
    build: (url, token) => json({ mcpServers: { [SERVER_NAME]: { command: "npx", args: bridgeArgs(url, token) } } }),
    tips: ["配置文件位置以 DeepSeek Harness 文档为准；不确定时用下面的测试确认"],
  },
  {
    key: "generic_http",
    label: "通用 · HTTP",
    where: "支持远程 MCP（Streamable HTTP）的 Agent：填地址和请求头",
    lang: "json",
    build: httpEntry("url"),
    tips: ["字段名各家可能不同（url / serverUrl / httpUrl），意思一样：地址 + Authorization 请求头"],
  },
  {
    key: "generic_bridge",
    label: "通用 · 命令桥接",
    where: "只支持本地命令（stdio）的 Agent：用 mcp-remote 转接（需要电脑上有 Node.js）",
    lang: "json",
    build: (url, token) => json({ mcpServers: { [SERVER_NAME]: { command: "npx", args: bridgeArgs(url, token) } } }),
    tips: ["Windows 上 command 可能要写 npx.cmd"],
  },
];

export function presetOf(key: string) {
  return AGENT_PRESETS.find((p) => p.key === key) || null;
}

/** 系统地址 → MCP 地址；只接受 http / https，去掉路径 */
export function normalizeBaseUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  return u.origin;
}

export function mcpUrlOf(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, "")}/api/mcp`;
}

export function testPrompt(code: string) {
  return `调用 ${SERVER_NAME} 的 ${TEST_TOOL} 工具，code 填 ${code}`;
}

export type ConnState = "verified" | "testing" | "failed" | "untested" | "token_invalid";
export const CONN_STATE_LABEL: Record<ConnState, string> = { verified: "已连通", testing: "测试中", failed: "连不上", untested: "未测试", token_invalid: "令牌失效" };

export function connState(c: { verifiedAt: Date | string | null; lastTestAt: Date | string | null; testCode: string | null; testExpiresAt: Date | string | null }, tokenOk: boolean, now = new Date()): ConnState {
  if (!tokenOk) return "token_invalid";
  if (c.testCode && c.testExpiresAt && new Date(c.testExpiresAt).getTime() > now.getTime()) return "testing";
  if (c.verifiedAt && (!c.lastTestAt || new Date(c.verifiedAt).getTime() >= new Date(c.lastTestAt).getTime())) return "verified";
  if (c.lastTestAt) return "failed";
  return "untested";
}
