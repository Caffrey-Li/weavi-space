# Docker 部署

一套 `docker compose` 起三个服务：`web`（小围空间 Weavi Space）、`db`（PostgreSQL 16）、`minio`（S3 兼容存储，存头像、项目图标和加密配置）。数据都在 Docker 数据卷里，重建容器不会丢。

## 第一次启动

```bash
cp docker/.env.example docker/.env
# 编辑 docker/.env：POSTGRES_PASSWORD、MINIO_ROOT_PASSWORD、AUTH_SECRET、ENCRYPTION_KEY 必填
# （可用 openssl rand -base64 48 生成）；INITIAL_ADMIN_EMAIL 可不填，改用首次安装向导
docker compose --env-file docker/.env up -d --build
docker compose --env-file docker/.env logs web    # 找「临时密码（只显示这一次）」
```

打开 `http://localhost:3000`（`WEB_PORT` 可改）：

- 没填 `INITIAL_ADMIN_EMAIL`：进入「首次安装向导」，安装码在 `docker compose --env-file docker/.env logs web | grep 安装码`，再自己设超级管理员的邮箱和密码。
- 填了：用它和日志里的临时密码登录，首次登录必须修改密码。库里已经有系统管理员时不会再创建。

忘了超级管理员密码：`docker compose --env-file docker/.env exec web npm run reset-admin -- <邮箱>` 生成重置链接。

容器每次启动都会先执行 `prisma migrate deploy`（只做增量），再启动服务。健康检查：`GET /api/healthz`，不需要登录，数据库可用时返回 200。

## 上线前

- 走 HTTPS：反向代理（Nginx、Caddy 等）终止 TLS，`APP_URL` 改成对外地址，`COOKIE_SECURE=true`；代理会设置 `X-Forwarded-For` 时 `TRUST_PROXY=1`。
- 不要把 MinIO 的 9000 / 9001 端口暴露到公网（compose 默认没有映射到宿主机）。
- `ENCRYPTION_KEY` 设置后不要再改，否则已加密的配置（飞书凭据等）解不开。
- 其他安全要求见 `docs/SECURITY.md`。

## 备份和恢复

```bash
bash docker/backup.sh                     # 结果在 backups/<时间>/：db.dump + objects/
bash docker/restore.sh backups/<时间>     # 覆盖当前数据库和存储桶，需要输入项目名确认
```

备份时服务不用停；恢复期间 web 会停止，完成后自动启动。备份目录里有全部业务数据，按敏感数据保管。

## 验证部署包

在装了 Docker 的机器上：

```bash
bash docker/verify.sh
```

用独立的项目名 `nova-verify` 和端口 3300，自己生成密钥，依次检查构建启动、健康检查、初始管理员、登录改密、头像存进 MinIO 并能读回、存储桶不允许匿名访问、备份、恢复、重启后数据仍在。结束时删掉验证用的容器、数据卷和备份（`KEEP=1` 保留以便排查）。不会碰 `docker/.env` 对应的正式项目。
