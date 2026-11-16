#!/usr/bin/env bash
# 生成单文件 HTML 本地预览：建临时 PostgreSQL 库、导入 prisma/demo.db（SQLite 演示库）的副本，起临时服务，抓全部页面后关掉服务并删库。
# 用法：bash scripts/html-preview.sh [输出文件]；PREVIEW_PG_URL 指定用来建 / 删临时库的连接（默认 postgresql://localhost:5432/postgres）
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-$HOME/tmp/agent-work/2026-11-01-html-preview/nova-collab-preview.html}"
PORT=3102
ADMIN_URL="${PREVIEW_PG_URL:-postgresql://localhost:5432/postgres}"
DB_NAME="pm_collab_preview_demo_$$"
WORK="$(mktemp -d)"
cleanup() {
  [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null || true
  psql "$ADMIN_URL" -X -q -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
mkdir -p "$(dirname "$OUT")"
psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB_NAME\""
export DATABASE_URL="$(node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];process.stdout.write(u.toString())' "$ADMIN_URL" "$DB_NAME")" NEXT_DIST_DIR=.next-preview
unset TURSO_DATABASE_URL TURSO_AUTH_TOKEN UPLOAD_STORE
npx prisma migrate deploy > "$WORK/migrate.log" 2>&1 || { cat "$WORK/migrate.log"; exit 1; }
cp prisma/demo.db "$WORK/preview.db"
npx tsx scripts/migrate-sqlite-to-pg.ts --source "$WORK/preview.db" --yes > "$WORK/import.log" 2>&1 || { cat "$WORK/import.log"; exit 1; }
# 演示库里的默认账号密码不合规；本地快照允许直接登录（只影响这个临时服务）
export ALLOW_DEFAULT_PASSWORDS=1
npx next build apps/web > "$WORK/build.log" 2>&1 || { tail -30 "$WORK/build.log"; echo "构建失败，未生成预览"; exit 1; }
./node_modules/.bin/next start apps/web -p "$PORT" > "$WORK/server.log" 2>&1 &
PID=$!
for _ in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$PORT/login" && break; sleep 1; done
npx tsx scripts/html-preview.ts "http://localhost:$PORT" "$OUT"
