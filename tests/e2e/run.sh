#!/usr/bin/env bash
# Playwright 冒烟测试：建一个临时 PostgreSQL 测试库 → 执行迁移 → 导入演示数据（SQLite 演示库副本，可选）→ 建测试账号 → 起服务跑用例 → 删库。
# 环境变量：
#   SMOKE_PG_URL     用来建 / 删临时库的连接（默认 postgresql://localhost:5432/postgres，需要建库权限）
#   SMOKE_SOURCE_DB  导入的 SQLite 演示库（默认当前仓库的 prisma/demo.db，worktree 里没有时请显式指定；设为 none 不导入，只用测试账号自带的数据）
set -euo pipefail
cd "$(dirname "$0")/../.."
admin_url="${SMOKE_PG_URL:-postgresql://localhost:5432/postgres}"
source_db="${SMOKE_SOURCE_DB:-$PWD/prisma/demo.db}"
if [[ "$source_db" != "none" && ! -f "$source_db" ]]; then echo "找不到演示库 ${source_db}：用 SMOKE_SOURCE_DB 指定，或设为 none" >&2; exit 1; fi
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/pm-smoke.XXXXXX")"
db_name="pm_collab_smoke_$(node -e 'process.stdout.write(require("crypto").randomBytes(4).toString("hex"))')"
server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  psql "$admin_url" -X -q -c "DROP DATABASE IF EXISTS \"$db_name\" WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT
if curl -fsS http://127.0.0.1:3112/login >/dev/null 2>&1; then
  echo "端口 3112 已被占用，拒绝运行测试" >&2
  exit 1
fi
psql "$admin_url" -X -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db_name\""
export DATABASE_URL="$(node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];process.stdout.write(u.toString())' "$admin_url" "$db_name")"
export AUTH_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
export COOKIE_SECURE=false
export SMOKE_FIXTURE="$work_dir/fixture.json"
export SMOKE_RESULTS="$work_dir/results"
npx prisma migrate deploy
if [[ "$source_db" != "none" ]]; then
  cp "$source_db" "$work_dir/demo-test.db"
  npx tsx scripts/migrate-sqlite-to-pg.ts --source "$work_dir/demo-test.db" --yes
fi
npx tsx scripts/security-e2e/seed.ts "$SMOKE_FIXTURE"
# 本机同时跑着 3100 / 3101 时 PostgreSQL 连接数会不够，测试服务的连接池限小一点
DATABASE_URL="${DATABASE_URL}?connection_limit=8" ./node_modules/.bin/next start apps/web -p 3112 > "$work_dir/server.log" 2>&1 &
server_pid=$!
for ((i=0; i<60; i++)); do
  if curl -fsS http://127.0.0.1:3112/login >/dev/null 2>&1; then break; fi
  if ! kill -0 "$server_pid" 2>/dev/null; then cat "$work_dir/server.log"; exit 1; fi
  sleep 1
done
if ! npx playwright test; then
  echo "===== 服务端日志（最后 80 行）"
  tail -80 "$work_dir/server.log"
  exit 1
fi
