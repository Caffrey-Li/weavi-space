#!/usr/bin/env bash
# 验证「直接安装」流程（不用 Docker）。在仓库根目录运行：
#   VERIFY_PG_URL=postgresql://用户:密码@localhost:5432/postgres bash deploy/verify.sh
# VERIFY_PG_URL 要能建库；没设时读 .env 里的 SMOKE_PG_URL。会新建一个临时库，跑完删除。
# 在临时目录里放一份当前提交的代码（依赖从本仓库复制），按 deploy/setup.sh 安装，端口 3300 启动，
# 检查健康检查、初始管理员、登录改密、上传头像、备份、恢复、重复执行 setup 不重复建管理员。不碰当前目录的数据。
# FULL=1 时在临时目录里真正执行 npm ci（需要网络，较慢）。KEEP=1 保留临时目录和库以便排查。
set -uo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
[[ -d /opt/homebrew/opt/postgresql@16/bin ]] && export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
for c in node npm psql pg_dump pg_restore curl openssl git tar; do command -v $c >/dev/null || { echo "缺少命令：$c"; exit 1; }; done
admin_url="${VERIFY_PG_URL:-}"
[[ -z "$admin_url" && -f .env ]] && admin_url="$(sed -n 's/^SMOKE_PG_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' .env | tail -1)"
[[ -n "$admin_url" ]] || { echo "请设置 VERIFY_PG_URL（能建库的 PostgreSQL 连接串）"; exit 1; }
port=3300; base="http://localhost:$port"; email="admin@verify.test"
if curl -fsS "$base" >/dev/null 2>&1; then echo "端口 $port 已被占用"; exit 1; fi
work="$(mktemp -d "${TMPDIR:-/tmp}/nova-deploy.XXXXXX")"; app="$work/app"
db="nova_verify_test_$(openssl rand -hex 4)"; server_pid=""
pass_n=0; fail_n=0; results=()
ok() { if [[ "$2" == 1 ]]; then pass_n=$((pass_n+1)); results+=("✓ $1"); echo "✓ $1"; else fail_n=$((fail_n+1)); results+=("✗ $1"); echo "✗ $1"; fi; }
yes_if() { if "$@"; then echo 1; else echo 0; fi; }
stop() { [[ -n "$server_pid" ]] && { kill "$server_pid" 2>/dev/null; wait "$server_pid" 2>/dev/null; server_pid=""; }; }
cleanup() {
  stop
  if [[ "${KEEP:-0}" == 1 ]]; then echo "KEEP=1：保留 $work 和数据库 $db"; return; fi
  psql "$admin_url" -X -q -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT

echo "== 准备临时目录和数据库"
mkdir -p "$app" && git archive HEAD | tar -x -C "$app"
if [[ "${FULL:-0}" != 1 ]]; then cp -cR node_modules "$app/node_modules" 2>/dev/null || cp -R node_modules "$app/node_modules"; fi
psql "$admin_url" -X -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\"" >/dev/null || { echo "建库失败"; exit 1; }
db_url="$(node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];process.stdout.write(u.toString())' "$admin_url" "$db")"
rand() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40; }
cat > "$app/.env" <<ENV
DATABASE_URL="$db_url"
AUTH_SECRET="$(rand)"
ENCRYPTION_KEY="$(rand)"
APP_URL="$base"
COOKIE_SECURE=false
INITIAL_ADMIN_EMAIL="$email"
ENV
chmod 600 "$app/.env"
cd "$app"

echo "== deploy/setup.sh（迁移、初始管理员、构建）"
SKIP_INSTALL=$([[ "${FULL:-0}" == 1 ]] && echo 0 || echo 1) bash deploy/setup.sh > "$work/setup.log" 2>&1
ok "setup.sh 完成" $([[ $? == 0 ]] && echo 1 || echo 0)
temp="$(sed -n 's/.*临时密码（只显示这一次）：\([^，]*\)，.*/\1/p' "$work/setup.log" | tail -1)"
ok "创建初始管理员" $(yes_if test -n "$temp")

# 直接起 next（npm run start 就是这条命令），方便停止时不留子进程
start() { (set -a; source .env; set +a; exec ./node_modules/.bin/next start apps/web -p "$port") > "$work/server.log" 2>&1 & server_pid=$!
  for _ in $(seq 1 60); do [[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/api/healthz")" == 200 ]] && return 0; kill -0 "$server_pid" 2>/dev/null || return 1; sleep 1; done; return 1; }
start; ok "启动并通过健康检查" $([[ $? == 0 ]] && echo 1 || echo 0)
ok "未登录访问接口返回 401" $(yes_if test "$(curl -s -o /dev/null -w '%{http_code}' "$base/api/projects")" = 401)

jar="$work/cookies"
login_body() { printf '{"account":"%s","password":"%s"}' "$email" "$1"; }
change_body() { printf '{"currentPassword":"%s","newPassword":"%s"}' "$1" "$2"; }
post() { curl -s -o "$work/resp" -w '%{http_code}' -b "$jar" -c "$jar" -H "Origin: $base" -H "Content-Type: application/json" -X POST "$base$1" -d "$2"; }
code="$(post /api/auth/login "$(login_body "$temp")")"; ok "用临时密码登录" "$(yes_if test "$code" = 200)"
newpw="Nv-$(rand | cut -c1-16)9a"
code="$(post /api/auth/change-password "$(change_body "$temp" "$newpw")")"; ok "强制修改密码" "$(yes_if test "$code" = 200)"
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | openssl base64 -d -A > "$work/a.png"
code="$(curl -s -o "$work/resp" -w '%{http_code}' -b "$jar" -c "$jar" -H "Origin: $base" -F "file=@$work/a.png;type=image/png" "$base/api/auth/avatar")"
avatar="$(sed -n 's/.*"avatarUrl":"\([^"]*\)".*/\1/p' "$work/resp")"
ok "上传头像，文件写进 public/uploads" $(yes_if test "$code" = 200 -a -n "$avatar" -a -f "public${avatar%%\?*}")
avatar_ok() { [[ -n "$avatar" && "$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" "$base$avatar")" == 200 ]]; }
ok "头像能读回" $(yes_if avatar_ok)

echo "== 备份 → 删掉头像 → 恢复"
bash deploy/backup.sh "$work/backups" > "$work/backup.log" 2>&1; bcode=$?
bdir="$(ls -d "$work"/backups/*/ 2>/dev/null | head -1)"
ok "备份数据库和文件" $(yes_if test $bcode = 0 -a -s "${bdir}db.dump" -a -s "${bdir}files.tar.gz")
[[ -n "$avatar" ]] && rm -f "public${avatar%%\?*}"
stop
RESTORE_CONFIRM="$db" bash deploy/restore.sh "${bdir%/}" > "$work/restore.log" 2>&1
ok "恢复" $([[ $? == 0 ]] && echo 1 || echo 0)
start; ok "恢复后启动正常" $([[ $? == 0 ]] && echo 1 || echo 0)
rm -f "$jar"
code="$(post /api/auth/login "$(login_body "$newpw")")"; ok "恢复后用新密码登录" "$(yes_if test "$code" = 200)"
ok "恢复后头像回来了" $(yes_if avatar_ok)

echo "== 再执行一次 setup.sh（模拟升级）"
stop
SKIP_INSTALL=1 bash deploy/setup.sh > "$work/setup2.log" 2>&1
ok "重复执行 setup.sh 成功" $([[ $? == 0 ]] && echo 1 || echo 0)
ok "不会重复创建管理员" $(yes_if grep -q "已有系统管理员，跳过" "$work/setup2.log")
start; rm -f "$jar"
code="$(post /api/auth/login "$(login_body "$newpw")")"; ok "升级后登录" "$(yes_if test "$code" = 200)"

echo; echo "==== 汇总：通过 ${pass_n}，失败 $fail_n ===="
printf '%s\n' "${results[@]}"
if [[ $fail_n -gt 0 ]]; then
  # 失败时把各步日志拷到仓库的 tmp/deploy-verify-logs/（tmp 不进 git），方便排查；临时密码打码
  keep="$root/tmp/deploy-verify-logs"; rm -rf "$keep"; mkdir -p "$keep"
  for f in setup.log server.log backup.log restore.log setup2.log; do
    [[ -f "$work/$f" ]] && sed -E 's/(临时密码（只显示这一次）：)[^，]*/\1***/' "$work/$f" > "$keep/$f"
  done
  printf '%s\n' "${results[@]}" > "$keep/summary.txt"
  echo "失败日志已保存到 ${keep}"
  exit 1
fi
