/**
 * 需求交付测试执行器（独立进程，T27 二期）：`npm run worker:test`
 *
 * web 进程设 TEST_RUNNER=worker 后不再自己跑测试，由这个进程每 5 秒领取排队中的「服务器执行」一轮或试跑。
 * 用和 web 相同的 .env（DATABASE_URL、AUTH_SECRET / ENCRYPTION_KEY——测试账号密码是加密存的，密钥不同解不开）。
 * 同一时间只跑一轮；退出时正在跑的一轮会在下次启动时续跑没出结果的用例（只续跑一次）。
 * 部署示例：deploy/weavi-test-worker.service（systemd）、deploy/ecosystem.config.cjs（pm2）。
 */
import { existsSync } from "node:fs";

// 和 next start 一样读仓库根目录的 .env（已在环境变量里设置的不覆盖）；要在加载业务代码之前
if (existsSync(".env")) process.loadEnvFile(".env");

const INTERVAL = 5000;
let stopping = false;

async function loop() {
  const { kickRunner } = await import("@pm-collab/core/delivery/runner");
  console.log("[测试执行器] 已启动，每 5 秒检查一次排队中的测试");
  while (!stopping) {
    await kickRunner({ worker: true });
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log("[测试执行器] 收到退出信号；正在跑的一轮会在下次启动时续跑");
    process.exit(0);
  });
}

void loop();
