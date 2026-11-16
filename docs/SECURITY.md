# 上线安全清单（Nova Collab）

2026-11-01，11-04 更新。代码里已经做了的防护，以及部署到公网前需要人来完成的配置。完整审计结果见 `SECURITY-AUDIT-2026-11.md`。

## 代码已内置

| 项 | 位置 | 说明 |
|---|---|---|
| 密钥校验 | `apps/web/src/lib/auth-secret.ts`、`apps/web/src/instrumentation-node.ts` | 生产环境 `AUTH_SECRET` 缺失、为 `dev-secret` 或不足 32 位、`ENCRYPTION_KEY` 配了但不足 32 位：拒绝启动。开发环境随机生成到 `.data/dev-auth-secret` |
| 配置加密 | `apps/web/src/lib/secure-config.ts` | 优先用 `ENCRYPTION_KEY`，密文带 `keyVersion`，旧密文可读、下次写入迁移 |
| 角色层级 | `apps/web/src/lib/roles-shared.ts`、`apps/web/src/lib/org-shared.ts`、`apps/web/src/lib/admin-gate.ts` | 系统管理员是唯一超管；管理者只能管所属二级组织内级别比自己低的账号，不能改角色、权限矩阵、岗位和系统配置 |
| 企业隔离 | `apps/web/src/lib/access.ts`、`apps/web/src/lib/enterprise.ts` | 除系统管理员外只能碰本企业的数据；项目、产品有 `enterpriseId`，公共池跟随创建人企业 |
| 页面鉴权 | `apps/web/src/proxy.ts`、`apps/web/src/lib/session-check.ts` | 渲染前查库校验会话；不要在布局里做鉴权（页面和布局并行渲染） |
| 服务端会话 | `apps/web/src/lib/auth.ts`、`sessions` 表 | Cookie 只存随机令牌，库里存 SHA-256；`getSession` 每次读库；登出、改密、停用、改角色、改账号、重置密码都吊销。强制改密也在这里实施。失效时经 `GET /api/auth/logout` 清 Cookie 回登录页 |
| CSRF | `apps/web/src/proxy.ts`、`apps/web/src/lib/origin-check.ts` | 所有写请求校验 Origin 与 Host |
| 上传 | `apps/web/src/lib/upload-guard.ts`、`apps/web/src/lib/svg-sanitize.ts` | 按魔数判定类型，5MB 上限，随机文件名，SVG 白名单清洗 |
| 富文本 | `apps/web/src/lib/doc-html.ts` | `sanitize-html` 白名单清洗后入库 |
| Cookie | `apps/web/src/lib/auth.ts` | httpOnly、SameSite=Lax；生产环境默认 Secure（本机 http 例外） |
| 登录限流 | `apps/web/src/lib/rate-limit.ts`、`/api/auth/login`、飞书回调 | 同一 IP 15 分钟 60 次；同一 IP + 账号连续失败 5 次锁 15 分钟；同一账号累计 20 次全局锁。成功 / 失败 / 锁定 / 登出 / 改密写入活动日志（entityType=security）和服务端日志。只有 `TRUST_PROXY=1` 才信 X-Forwarded-For |
| 密码规则 | `apps/web/src/lib/password-policy.ts` | 至少 10 位，含字母和数字，不能是常见密码、不能包含账号名；生产环境用不合规密码登录会被强制改密 |
| 安全响应头 | `apps/web/src/proxy.ts`、`next.config.mjs` | 页面 CSP 用每次请求的 nonce + strict-dynamic；接口和上传文件 `default-src 'none'; sandbox`；HSTS（生产）、X-Frame-Options、nosniff、Referrer-Policy、Permissions-Policy、COOP；去掉 X-Powered-By |
| 附件 | `/api/attachments/[id]`、`apps/web/src/lib/attachments.ts` | 可见范围跟随挂载对象的数据范围；草稿附件只有上传者和管理员能读；非图片一律下载 |
| 清库保护 | `prisma/guard-destructive.ts` | `db:seed`、`db:reset`、`db:upsert-test-users` 遇到 NODE_ENV=production、Turso、非本机 PostgreSQL，或库名不带 local / demo / test 等字样（真实库 `pm_collab`）直接拒绝 |

## 部署时需要人来做

1. **密钥**：`openssl rand -base64 48` 分别生成 `AUTH_SECRET` 和 `ENCRYPTION_KEY`，只放服务器环境变量；上线后不能再改（会让已加密的飞书凭据失效）。
2. **账号**：线上库删除或停用所有 `@local` 测试账号；管理员改成强密码；优先用飞书登录。
3. **访问入口**：放在 VPN / 零信任网关 / IP 白名单后面（如 Cloudflare Access），不要全公网开放。
4. **HTTPS**：反向代理（Nginx / Caddy）终止 TLS，应用只监听 127.0.0.1；设 `TRUST_PROXY=1` 和 `APP_URL`（不设时取不到真实 IP，IP 限流不生效），并设请求体上限（约 10MB）。
5. **单实例**：登录限流存在进程内存里；多实例部署需换成 Redis 等共享存储。
6. **数据库**：Turso 令牌只放环境变量、最小权限、定期轮换；每天自动备份到异地并加密，定期做恢复演练。
7. **AI 助手**：配置 `ANTHROPIC_API_KEY` 后，查询范围内的需求数据会发给模型服务商；有保密要求就不配置。
8. **依赖**：定期 `npm audit`（使用镜像源时加 `--registry=https://registry.npmjs.org`），Next.js 跟到最新补丁版本。
9. **监控**：对活动日志里的 `security` 事件和 401 / 403 / 429 激增设告警；上线前用 OWASP ZAP 扫一遍。

## 已知限制

- 公共池需求、全员邮箱（`/api/meta`）对登录用户可见，是现有产品设计，见审计报告第 3 节。
- 服务端会话上线后，所有人需要重新登录一次。
