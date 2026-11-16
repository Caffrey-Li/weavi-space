# 部署到阿里云 ECS

把已有部署（或本机）的小围空间整套搬到阿里云。推荐「ECS + 直接安装」：应用和 PostgreSQL 都在一台 ECS 上，上传文件存本机磁盘。想用 Docker 见 [`docker/README.md`](../../docker/README.md)，想用 RDS / OSS 见文末。

## 1. 阿里云上要准备的

| 项目 | 建议 | 说明 |
|---|---|---|
| ECS | 2 核 4 GB 更稳；2 核 2 GB 也能跑（几十人内），系统盘 40 GB，Ubuntu 22.04 / 24.04 或 Alibaba Cloud Linux 3 | 平时运行应用约 400 MB + PostgreSQL 约 300 MB；构建（`npm run build`）峰值 2～3 GB。2 GB 的机器：先加 4 GB swap，构建时 `NODE_OPTIONS=--max-old-space-size=1536`，构建前可先停服务；不要用带 MinIO 的 Docker 方案 |
| 地域 | 国内地域（杭州、上海、北京等） | **国内地域用域名对外访问必须先做 ICP 备案**，备案期间只能用 IP 访问。选香港 / 新加坡不需要备案，但国内访问会慢一些 |
| 安全组 | 入方向只放行 22（限你的 IP）、80、443 | 不要放行 3000（应用）和 5432（数据库） |
| 域名和证书 | 阿里云「数字证书管理服务」免费证书，或 Let's Encrypt | 证书装在 Nginx 上，示例见 [`nginx.conf`](./nginx.conf) |
| 镜像源 | npm 用 `https://registry.npmmirror.com`，Prisma 引擎用 `PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma` | 国内 ECS 直连 npm 官方源和 Prisma 下载地址很慢或失败 |

## 2. 服务器上装软件

```bash
# Node.js 22（用 nvm 或 NodeSource）、PostgreSQL 16、Nginx
sudo timedatectl set-timezone Asia/Shanghai     # 周报定时发送按服务器本地时间
npm config set registry https://registry.npmmirror.com
```

PostgreSQL 建专用账号和库（账号要是库的所有者，恢复备份要用）：

```sql
CREATE ROLE weavi LOGIN PASSWORD '<强密码>';
CREATE DATABASE weavi_space OWNER weavi;
```

2 核 2 GB 的机器先加 swap，PostgreSQL 调小内存：

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
# postgresql.conf：shared_buffers = 256MB，work_mem = 8MB，max_connections = 50，改完重启 PostgreSQL
```

## 3. 代码和配置

1. 把代码放到 `/opt/weavi-space`（`git clone` 或把本机仓库打包上传，不要带 `node_modules`、`.next`、`tmp`、`.env`）。
2. 在服务器上新建 `.env`（不要从本机直接复制整个文件），内容：

   | 变量 | 怎么填 |
   |---|---|
   | `DATABASE_URL` | `postgresql://weavi:<密码>@127.0.0.1:5432/weavi_space` |
   | `AUTH_SECRET` | **和本机 `.env` 里的值完全一样**（手机号查找用它派生；不一样的话已绑定的手机号查不到） |
   | `ENCRYPTION_KEY` | **和本机 `.env` 里的值完全一样**（AI 模型 Key、登录方式密钥、手机号都是用它加密的；不一样就解不开） |
   | `APP_URL` | `https://<你的域名>`（飞书 / 企业微信 / 钉钉回调、通知里的链接都用它） |
   | `TRUST_PROXY` | `1`（前面有 Nginx） |
   | `PRISMA_ENGINES_MIRROR` | `https://registry.npmmirror.com/-/binary/prisma` |

   ITR 同步的 `FEISHU_ITR_*` 按需从本机抄过来。`TEST_PG_URL` 只是本机测试用，不要带。
3. `bash deploy/setup.sh`：装依赖、执行迁移、构建（2 GB 内存的机器用 `NODE_OPTIONS=--max-old-space-size=1536 bash deploy/setup.sh`，升级时先 `sudo systemctl stop weavi-space` 再构建）。数据库是空库时会建一个初始管理员；下一步恢复数据会覆盖它。

## 4. 搬数据（本机 → 阿里云）

数据库不需要做结构转换：本机和服务器都是 PostgreSQL 16，表结构由 `prisma/migrations`（当前 11 个，本机已全部执行）管理，整库备份恢复即可。附件、架构图都存在数据库里；头像、项目图标在 `public/uploads`，加密配置在 `.data`，备份脚本会一起打包。

```bash
# 旧环境（仓库根目录，读那里 .env 里的数据库）
bash deploy/backup.sh            # 生成 backups/<时间>/db.dump 和 files.tar.gz
scp -r backups/<时间> root@<ECS 公网 IP>:/opt/weavi-space/backups/

# 服务器（先停服务）
cd /opt/weavi-space
bash deploy/restore.sh backups/<时间>     # 输入数据库名 weavi_space 确认
npx prisma migrate deploy                  # 应该提示没有待执行的迁移
```

备份里有全部业务数据和加密配置，传完从本机和服务器上删掉，或按敏感数据保管。搬迁当天旧环境先别再录数据，避免两边不一致。

## 5. 启动和反向代理

```bash
sudo cp deploy/nova-collab.service /etc/systemd/system/weavi-space.service
# 改 User=、WorkingDirectory=/opt/weavi-space
sudo systemctl daemon-reload && sudo systemctl enable --now weavi-space
curl -fsS http://127.0.0.1:3000/api/healthz      # 返回正常即可

sudo cp deploy/aliyun/nginx.conf /etc/nginx/conf.d/weavi-space.conf   # 改域名、证书路径
sudo nginx -t && sudo systemctl reload nginx
```

升级：`git pull && bash deploy/setup.sh && sudo systemctl restart weavi-space`。每天备份：`crontab` 里加 `bash deploy/backup.sh /data/backups`，备份目录最好再同步到 OSS。

## 6. 搬完要改的配置

- **第三方登录回调地址**：飞书、企业微信、钉钉开放平台里，把重定向 / 回调地址改成新域名（`https://<域名>/api/auth/sso/<方式>/callback`、飞书系统级是 `/api/auth/feishu/callback`），在「设置 · 登录管理」里核对。
- **邮箱验证码**：阿里云 ECS 默认封禁出方向 25 端口，SMTP 用 465（SSL）或 587。
- **短信验证码**：阿里云短信要先审核通过签名和模板，再填到「登录管理 · 手机号」。
- **AI 模型**：国内 ECS 访问不了 Anthropic、OpenAI、Gemini 的接口。在国内部署时用 DeepSeek、通义千问、智谱、Kimi、豆包，或者给这几家配可访问的代理地址（地址不能是内网 IP，系统会拒绝）。
- **飞书机器人 / 云表格 / 云文档**：飞书开放平台的 IP 白名单（如果开了）加上 ECS 公网 IP。

## 可选：RDS 和 OSS

- **RDS PostgreSQL 16**：白名单加 ECS 内网 IP，`DATABASE_URL` 用 RDS 内网地址；用「高权限账号」或库的所有者账号建库，`restore.sh` 需要能删建 schema。`pg_dump` / `pg_restore` 客户端版本要 ≥ 16。
- **OSS 存头像和项目图标**：建私有存储桶，用 RAM 子账号（只授权这个桶），`.env` 配置见 `.env.example` 里的「阿里云 OSS 示例」（`S3_FORCE_PATH_STYLE=false`，同地域用 `-internal` 内网地址）。切换前把 `public/uploads/<目录>/<文件>` 传到桶里 `uploads/<目录>/<文件>`，`.data/secure-config.json` 传到 `config/secure-config`。数据量很小（目前约 140 KB），一般直接用本机磁盘就够了。
