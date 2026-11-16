/** 服务启动时执行一次（Next.js instrumentation）：检查数据库迁移、数据校正、生产环境安全自检 */
export async function register() {
  // 条件必须直接写在 import 外面，Edge 包里才会整段去掉
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startNode } = await import("./instrumentation-node");
    await startNode();
  }
}
