// pm2 示例（macOS / Linux 都能用）：
//   npm install -g pm2
//   pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup   # 最后一条按提示执行，开机自启
// 升级：bash deploy/setup.sh && pm2 restart nova-collab
module.exports = {
  apps: [
    {
      name: "nova-collab",
      cwd: __dirname + "/..",
      script: "npm",
      args: "run start",
      env: { NODE_ENV: "production", PORT: "3000" },
      max_restarts: 10,
      restart_delay: 5000,
    },
    // 可选：测试执行器独立进程。启用时给上面的 web 加 TEST_RUNNER: "worker"，再取消下面的注释
    // {
    //   name: "weavi-test-worker",
    //   cwd: __dirname + "/..",
    //   script: "npm",
    //   args: "run worker:test",
    //   env: { NODE_ENV: "production" },
    //   max_restarts: 10,
    //   restart_delay: 10000,
    // },
  ],
};
