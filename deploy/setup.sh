#!/usr/bin/env bash
# 直接安装（不用 Docker）：检查环境 → 装依赖 → 数据库迁移 → 创建初始管理员 → 构建。
# 第一次安装和以后每次升级都用它，可以重复执行；做完后（重）启动服务即可。
# 用法：bash deploy/setup.sh            配置读仓库根目录的 .env
#       ENV_FILE=/path/to/env bash deploy/setup.sh
#       SKIP_INSTALL=1 …                 依赖已装好时跳过 npm ci
set -euo pipefail
cd "$(dirname "$0")/.."
env_file="${ENV_FILE:-.env}"
say() { echo "[安装] $*"; }
die() { echo "[安装] 失败：$*" >&2; exit 1; }

# 1. 环境
command -v node >/dev/null || die "没有 Node.js，需要 22 或更高版本"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" -ge 22 ]] || die "Node.js 版本是 $(node -v)，需要 22 或更高"
[[ -f "$env_file" ]] || die "找不到配置文件 ${env_file}：先 cp .env.example .env 并填写"
set -a; source "$env_file"; set +a
[[ -n "${DATABASE_URL:-}" ]] || die "$env_file 里没有 DATABASE_URL"
[[ "${DATABASE_URL}" == postgres* ]] || die "DATABASE_URL 必须是 PostgreSQL 连接串"
[[ "${#AUTH_SECRET}" -ge 32 ]] 2>/dev/null || die "AUTH_SECRET 没填或不足 32 位（openssl rand -base64 48 生成）"
if [[ -n "${ENCRYPTION_KEY:-}" && "${#ENCRYPTION_KEY}" -lt 32 ]]; then die "ENCRYPTION_KEY 不足 32 位"; fi
[[ -n "${ENCRYPTION_KEY:-}" ]] || say "提示：没有配置 ENCRYPTION_KEY，建议配置（设置后不要再改）"
[[ -n "${APP_URL:-}" ]] || say "提示：没有配置 APP_URL，通过域名或反向代理访问时要配置"
say "Node $(node -v)，配置 $env_file"

# 2. 依赖
if [[ "${SKIP_INSTALL:-0}" == 1 ]]; then say "跳过 npm ci"; else say "安装依赖（npm ci）"; npm ci --no-audit --no-fund; fi

# 3. 数据库
say "执行数据库迁移"
npx prisma migrate deploy

# 4. 初始管理员（已有系统管理员时跳过）
npx tsx scripts/create-admin.ts

# 5. 构建
say "构建"
npm run build
mkdir -p public/uploads .data
say "完成。启动：PORT=3000 npm run start（或用 deploy/README.md 里的 systemd / pm2 配置）"
