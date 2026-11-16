# 直接安装（不用 Docker）

在服务器或电脑上直接装 Node.js 和 PostgreSQL 运行。部署到阿里云见 [`deploy/aliyun/README.md`](./aliyun/README.md)。上传文件存在本机磁盘（`public/uploads`），不需要 MinIO。想用容器部署见 [`docker/README.md`](../docker/README.md)。

## 需要

- Node.js 22 或更高
- PostgreSQL 16（`pg_dump` / `pg_restore` 备份恢复要用，版本与服务器一致）
- 约 2 GB 磁盘（依赖和构建产物），数据另算

## 安装

1. 准备数据库：建一个专用账号和库，例如

   ```sql
   CREATE ROLE nova LOGIN PASSWORD '<强密码>';
   CREATE DATABASE nova_collab OWNER nova;
   ```

2. 配置：`cp .env.example .env`，至少填写：

   | 变量 | 说明 |
   |---|---|
   | `DATABASE_URL` | `postgresql://nova:<密码>@localhost:5432/nova_collab` |
   | `AUTH_SECRET` | 至少 32 位，`openssl rand -base64 48` 生成 |
   | `ENCRYPTION_KEY` | 推荐，至少 32 位；设置后不要再改，否则已加密的配置解不开 |
   | `APP_URL` | 对外访问地址，如 `https://collab.example.com` |
   | `INITIAL_ADMIN_EMAIL` | 可选。不填：第一次打开网站进入「首次安装向导」自己创建超级管理员（见下）；填了：安装时直接建这个系统管理员（库里已有系统管理员时忽略） |
   | `INITIAL_ADMIN_PASSWORD` | 可选；配合上一项，不填会生成随机临时密码，只在安装输出里显示一次 |

   本机 http 访问时加 `COOKIE_SECURE=false`；前面有反向代理并会设置 `X-Forwarded-For` 时加 `TRUST_PROXY=1`。

3. 安装：`bash deploy/setup.sh`。它会检查 Node 版本和必填配置、`npm ci`、执行数据库迁移、创建初始管理员、构建。

4. 启动：`PORT=3000 npm run start`，打开 `http://localhost:3000`。
   - 没配 `INITIAL_ADMIN_EMAIL`：自动进入「首次安装向导」。服务启动日志里有一行 `[安装向导] … 安装码：XXXX-XXXX`（`journalctl -u <服务名> | grep 安装码`），填进向导，再自己设超级管理员的邮箱和密码，顺手填系统名称和第一个企业。建好后向导永久关闭。安装码 24 小时有效，过期重启服务会生成新的。
   - 配了 `INITIAL_ADMIN_EMAIL`：用它和安装输出里的临时密码登录，首次登录必须修改密码。
   健康检查：`GET /api/healthz`（不需要登录）。

   忘了超级管理员密码：在仓库根目录执行 `npm run reset-admin` 列出超管，`npm run reset-admin -- <邮箱>` 生成 24 小时有效的重置链接（旧密码立即作废）。

## 长期运行

服务要从仓库根目录启动（上传文件、`.data` 都相对这个目录）。

- Linux：`deploy/nova-collab.service` 是 systemd 示例，改好路径和用户后 `sudo systemctl enable --now nova-collab`。
- macOS / Linux：`deploy/ecosystem.config.cjs` 是 pm2 示例，`pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup`。
- 对外提供服务时用 Nginx、Caddy 等做反向代理并启用 HTTPS，`COOKIE_SECURE` 保持默认（开启）。
- 可选：需求交付的「服务器执行」测试默认在 web 进程里跑。想让 web 重启不打断测试、测试也不拖慢页面，可以拆成独立进程：web 的环境里加 `TEST_RUNNER=worker`，再按 `deploy/weavi-test-worker.service` 起执行器（pm2 见 `ecosystem.config.cjs` 里注释掉的那一项）。两个进程读同一个 `.env`。

## 升级

```bash
git pull   # 或换成新版本的代码
bash deploy/setup.sh
# 然后重启：sudo systemctl restart nova-collab 或 pm2 restart nova-collab
```

`setup.sh` 可以重复执行：迁移只做增量，已有管理员时不会再建。升级前建议先备份。

## 备份和恢复

```bash
bash deploy/backup.sh                    # 结果在 backups/<时间>/：db.dump + files.tar.gz（上传文件和 .data）
bash deploy/restore.sh backups/<时间>    # 先停服务；覆盖当前数据库和上传文件，需要输入数据库名确认
```

恢复会先删掉备份里涉及的 schema（`public` 和后台队列的 `nova_jobs`）再整体导入，所以 `DATABASE_URL` 里的账号要是这个库的所有者（按上面的方式建库即可）。备份里有全部业务数据和加密配置，按敏感数据保管。

## 验证安装流程

```bash
VERIFY_PG_URL=postgresql://<能建库的账号>@localhost:5432/postgres bash deploy/verify.sh
```

在临时目录里用当前代码完整走一遍：安装、启动、初始管理员、登录改密、上传头像、备份、恢复、再次执行 setup。用临时数据库，端口 3300，结束时全部删除，不碰当前目录的数据。

## 公开演示站（可选）

想让别人不注册就能看一看时，单独部署一套演示站（独立数据库，库名要带 `demo`，例如 `weavi_demo`）：

1. `.env` 里加 `GUEST_DEMO=1`，登录页会出现「以访客身份体验」。访客只读：页面都能看，所有新建、修改、上传、生成令牌都会被拒绝。
2. 用演示数据初始化：`npm run db:seed`（会清空这个库，只允许库名带 local / demo / test）。
3. 每天自动重置演示数据（`crontab -e`）：

   ```
   30 4 * * * cd /opt/weavi-demo && npm run db:seed >> /var/log/weavi-demo-reset.log 2>&1
   ```

不要在真实数据的部署上开 `GUEST_DEMO`。

