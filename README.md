# 小围空间 Weavi Space

[English](./README.en.md) · 许可证 [AGPL-3.0](./LICENSE)

把人、事和 AI 织在一起的中文项目协同系统：工作台、公共 / 项目需求池、项目看板、发版、Bug、文档空间、产品结构、组织与权限，以及 AI 对话、个人能力和 MCP 接入。支持多企业数据隔离，飞书 / 企业微信 / 钉钉扫码登录。

> **安全警告**：本仓库含本地演示种子账号。切勿把演示密码、`.env`、真实飞书 token、或含真实数据的数据库文件部署到公网。上线前请阅读 [`docs/SECURITY.md`](./docs/SECURITY.md)。

## 技术栈

- Next.js 16（App Router，Turbopack）· React 19 · TypeScript（strict）
- Tailwind CSS 3 · Prisma 5 + PostgreSQL 16
- 服务端会话（`sessions` 表 + 随机令牌 Cookie，`bcryptjs`）
- `@dnd-kit` 看板拖拽 · `lucide-react` · `zod` · `date-fns`
- 可选：飞书 / 企业微信 / 钉钉登录、邮箱和短信验证码、云表格 / 云文档同步、9 家大模型厂商（企业定额）、MCP 服务

## 功能概览

| 模块 | 说明 |
|------|------|
| 工作台 / 进展总览 | KPI、我的待办、项目进度 |
| 需求 | 公共池与项目池、多阶段流转、看板拖拽、富文本、子需求与评论 |
| 项目 / 成员 | 项目概览、从已有账号添加项目成员与调整岗位、企业隔离 |
| 发版 | 规划 / 冻结 / 发布 / 上线；固定节奏与紧急发版 |
| Bug | 列表与看板、详情、备注 |
| 文档 | 空间与页面树、版本发布 |
| 产品 | 产品介绍、功能结构树、环境、架构图 |
| AI | AI 对话（可关联项目或本地文件夹）、个人能力（需求分析、PRD、原型图、测试用例）、AI 生图、MCP 服务 |
| 集成 | 飞书 / 企业微信 / 钉钉登录、飞书机器人、云表格、云文档、排期表同步（需自行配置） |
| 外观 | 「小围」暖色和「经典」蓝色两套风格，各有浅色 / 深色 |

## 本地开发安装

在**仓库根目录**执行（不要依赖某台机器的绝对路径）：

需要 Node.js 22.5+ 和 PostgreSQL 16（macOS：`brew install postgresql@16 && brew services start postgresql@16`）。

```bash
cp .env.example .env
# 必要配置：
#   DATABASE_URL="postgresql://localhost:5432/pm_collab_local"   # 库名带 local / demo / test 时才允许 db:seed
#   AUTH_SECRET="<至少 32 位随机串>"  # 例：openssl rand -base64 48
#   COOKIE_SECURE=false               # 本机 http 调试需要

createdb pm_collab_local
npm ci                 # postinstall 会 prisma generate
npx prisma migrate deploy   # 按 prisma/migrations 建表（含默认工作区）
npm run db:seed        # ⚠ 会清空当前 DATABASE_URL 指向的库；仅用于新建的 local 库
npm run dev            # 默认开发端口见 package.json；也可用 npx next dev -p <端口>
```

改表结构：先改 `prisma/schema.prisma`，再 `npx prisma migrate dev --name <名称>` 生成迁移并一起提交；部署时 `npx prisma migrate deploy`。不要在启动代码里建表加列。

从旧的 SQLite 库搬数据：`DATABASE_URL=<新库> npx tsx scripts/migrate-sqlite-to-pg.ts --source <SQLite 副本> --dry-run`，确认报告后把 `--dry-run` 换成 `--yes`（用法见脚本文件头）。

生成密钥：

```bash
openssl rand -base64 48
```

常用检查：

```bash
npx tsc --noEmit -p .
npm run lint
npm run build
npx tsx scripts/security.check.ts
```

贡献流程见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。冒烟清单见 [`SMOKE_TEST.md`](./SMOKE_TEST.md)。

### 演示账号（仅限本地 seed）

`npm run db:seed` 会写入 `@local` 演示账号。完整口令只出现在本地 `prisma/seed.ts` 运行输出中，**仅用于本地 / CI 演示库**。生产、预发或任何公网实例禁止使用；生产环境用不合规密码登录会被强制改密。

### 飞书排期表同步（可选）

同步前在 `.env` 配置（缺任一必填项时同步会报「未配置」，不会回落写死地址）：

```bash
FEISHU_ITR_WIKI_URL=
FEISHU_ITR_SPREADSHEET_TOKEN=
FEISHU_ITR_SHEET_ID=
# 可选：FEISHU_ITR_SHEET_TITLE=  FEISHU_ITR_SOURCE_TITLE=
# 另需 FEISHU_USER_ACCESS_TOKEN 或 FEISHU_APP_ID + FEISHU_APP_SECRET
```

## 部署

- 直接安装（Node.js 22 + PostgreSQL 16，上传存本机磁盘）：`bash deploy/setup.sh`，详见 [`deploy/README.md`](./deploy/README.md)；部署到阿里云见 [`deploy/aliyun/README.md`](./deploy/aliyun/README.md)。
- Docker：`docker compose` 一次起 Web、PostgreSQL 16 和 MinIO，详见 [`docker/README.md`](./docker/README.md)。

两种方式都有健康检查 `/api/healthz`、初始管理员创建和备份恢复脚本。

## 环境变量

模板见 [`.env.example`](./.env.example)。要点：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串，本地开发如 `postgresql://localhost:5432/pm_collab_local` |
| `AUTH_SECRET` | 生产必须 ≥ 32 位，否则拒绝启动 |
| `ENCRYPTION_KEY` | 推荐；配置加密专用密钥 |
| `COOKIE_SECURE` | 本机 http 调试设 `false` |
| `TRUST_PROXY` | 反代后才设为 `1` |
| `FEISHU_*` | 飞书登录与排期表同步 |
| `ANTHROPIC_API_KEY` | 可选 AI 助手 |

## 贡献

见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。Issue / PR 模板在 [`.github/`](./.github/)。

## 联系作者

部署遇到问题、想在公司内部落地，或者有功能建议，欢迎扫码加作者微信（备注「小围空间」），也可以直接提 Issue / PR。

<img src="./site/assets/wechat-qr.jpg" alt="作者微信二维码" width="220">

## 许可证

[GNU AGPL-3.0](./LICENSE)。可以自由使用、修改和分发；把修改后的版本作为网络服务提供给他人时，须向这些用户公开对应的完整源代码（AGPL 第 13 条）。系统「帮助」面板里有源代码链接，部署修改版时用 `NEXT_PUBLIC_SOURCE_CODE_URL` 指向你自己的代码地址（构建时生效）。

## 安全

疑似漏洞请按 [`docs/SECURITY.md`](./docs/SECURITY.md) 处理，不要在公开 Issue 中粘贴密钥、token、真实客户数据。
