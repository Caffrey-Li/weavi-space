# 贡献指南

感谢关注 Nova Collab。提交代码前请先阅读 [`docs/SECURITY.md`](./docs/SECURITY.md)。

## 开发环境

1. Node.js 与 npm 版本与仓库 `package.json` / lockfile 兼容。
2. 准备 PostgreSQL 16，`createdb pm_collab_local`。复制 `.env.example` → `.env`，默认 `DATABASE_URL="postgresql://localhost:5432/pm_collab_local"`；库名不带 local / demo / test 等字样时保护脚本会拒绝 `db:seed`。再填入随机 `AUTH_SECRET`（≥32 位，可用 `openssl rand -base64 48`）；本机 http 设 `COOKIE_SECURE=false`。
3. `npm ci` → `npx prisma migrate deploy` → `npm run db:seed`（只清并填充当前 local 库）。改表结构时用 `npx prisma migrate dev --name <名称>` 生成迁移，和 `schema.prisma` 一起提交。
4. `npm run dev` 启动后在浏览器验证。

## 分支与 PR

1. 从最新 `main` 拉功能分支。
2. 只做与议题相关的改动；不要顺手大重构。
3. 提交前至少通过：

   ```bash
   npx tsc --noEmit -p .
   npm run lint
   npm run build
   npx tsx scripts/security.check.ts
   ```

4. 若改动接口或权限，再按 `scripts/security-e2e/run.mjs` 文件头说明，对**数据库副本**跑安全 e2e。
5. 打开 PR 时填写模板：动机、改动摘要、验证步骤、风险与回滚。
6. **不要**提交 `.env`、密钥、`prisma/*.db`、真实客户导出、含人名 / 公司名的内部交接稿。

## 代码约定（摘要）

- 服务端组件默认；交互拆到 `apps/web/src/components/<领域>/`。
- API：`getSession` → 鉴权 → 校验 → `can()` → 写库 → `activityLog`。
- 数据范围走 `apps/web/src/lib/access.ts`；权限走 `permissions.ts` 的 `can()`。
- UI 文案中文；样式用 Nova 语义变量（`--nv-*`）。
- 不要引入与任务无关的新基础设施，除非议题明确要求。

## 安全与脱敏

- 禁止在代码、测试、文档、截图中写入真实飞书 wiki、spreadsheet token、生产密码、真实姓名与个人邮箱。
- 演示账号密码仅用于本地 seed；文档中说明「仅限本地」。
- 发现密钥泄露：轮换密钥，并通知维护者。

## Issue

- Bug：复现步骤、期望 / 实际、环境（浏览器、Node、是否演示库）。
- 功能：用户故事、非目标、验收标准。
- 不要在 Issue 里粘贴生产数据或凭证。

## 行为准则

保持友善、就事论事。侮辱、骚扰或故意破坏安全的行为不会被接受。
