/** 只在 Node 运行时执行的启动任务（由 instrumentation.ts 按运行时引入，避免把 Prisma 打进 Edge 包） */
import { alignToProjects } from "./lib/cascade";
import { authSecretProblem } from "./lib/auth-secret";
import { MIN_ENCRYPTION_KEY_LENGTH } from "./lib/secure-config";
import { backfillEnterprise } from "./lib/enterprise";
import { startScheduler } from "./lib/schedules";
import { backfillProjectArt, refreshDefaultCovers } from "./lib/project-art";
import { checkDatabaseReady } from "./lib/db-ready";
import { startAgent } from "./lib/agent-runner";
import { refreshSkillPacks } from "@pm-collab/core/skills/store";

/** 生产环境安全自检：密钥不合格直接退出，不带病运行（Next 只记录 instrumentation 的异常，不会自己退出） */
function securitySelfCheck() {
  if (process.env.NODE_ENV !== "production") return;
  const problems: string[] = [];
  const secret = authSecretProblem();
  if (secret) problems.push(`${secret}。请用 openssl rand -base64 48 生成密钥并写入环境变量后再启动。`);
  const enc = process.env.ENCRYPTION_KEY;
  if (enc && enc.length < MIN_ENCRYPTION_KEY_LENGTH) problems.push(`ENCRYPTION_KEY 不足 ${MIN_ENCRYPTION_KEY_LENGTH} 位。`);
  if (problems.length) {
    for (const p of problems) console.error(`[安全自检] ${p}`);
    // Netlify 函数里退出进程只会让每个请求都失败，抛错即可
    if (!process.env.NETLIFY) process.exit(1);
    throw new Error("[安全自检] 配置不合格，拒绝启动");
  }
  if (!enc) console.warn("[安全自检] 没有配置 ENCRYPTION_KEY：加密配置仍用 AUTH_SECRET 派生的密钥，建议配置独立密钥。");
  if (process.env.COOKIE_SECURE === "false") {
    console.warn("[安全自检] COOKIE_SECURE=false：登录 Cookie 不带 Secure，只应在本机 http 调试时使用。");
  }
  if (process.env.ALLOW_DEFAULT_PASSWORDS === "1") {
    console.warn("[安全自检] ALLOW_DEFAULT_PASSWORDS=1：允许默认密码直接登录，只应在本地预览时使用。");
  }
}

export async function startNode() {
  securitySelfCheck();
  // 表结构由 prisma/migrations 管理（npx prisma migrate deploy），启动时只检查迁移是否已执行，不再补表补列
  if (!(await checkDatabaseReady())) return;
  // 项目、产品回填所属企业（数据隔离的边界）
  try {
    const { filled, unresolved } = await backfillEnterprise();
    if (filled || unresolved) console.log(`[启动] 所属企业回填 ${filled} 条，${unresolved} 条推不出来，只有系统管理员可见`);
  } catch (e) {
    console.error("[启动] 所属企业回填失败：", e);
  }
  // 级联校正：需求 / Bug 的所属产品跟随项目
  try {
    await alignToProjects();
  } catch (e) {
    console.error("[启动] 产品-项目级联校正失败：", e);
  }
  // 一次性：给还没有配图的项目补上背景图和图标
  try {
    const n = await backfillProjectArt();
    if (n) console.log(`[启动] 已为 ${n} 个项目补上配图`);
    const g = await refreshDefaultCovers();
    if (g) console.log(`[启动] 已把 ${g} 个项目的默认背景图换成「辉光」风格`);
  } catch (e) {
    console.error("[启动] 项目补图失败：", e);
  }
  // 个人定时任务：每分钟检查一次（Netlify 上不启动）
  startScheduler();
  // 系统内 Agent：恢复重启前没跑完的任务（等确认的保持不动）
  try {
    await startAgent();
  } catch (e) {
    console.error("[启动] Agent 任务恢复失败：", e);
  }
  // 内置能力：读服务端已经下载的新版本（自动更新由任务队列每天检查）
  await refreshSkillPacks(true);
}
