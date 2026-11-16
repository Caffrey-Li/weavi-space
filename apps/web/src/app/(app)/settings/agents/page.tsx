import { WorkHeader } from "@/components/layout/WorkHeader";
import { AgentConnections } from "@/components/settings/AgentConnections";

export const dynamic = "force-dynamic";

/** 设置 · 个人 · 本机 Agent：按 Agent 生成 MCP 配置和专用令牌，并测试是否连通（T28） */
export default function AgentsPage() {
  return (
    <div className="nv-page-flush">
      <WorkHeader crumbs={[{ label: "本机 Agent", icon: "plug" }]} />
      <div className="nv-page-body">
        <AgentConnections />
      </div>
    </div>
  );
}
