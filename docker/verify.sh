#!/usr/bin/env bash
# 在装了 Docker 的机器上验证部署包（只需要 docker、curl、openssl）：
#   bash docker/verify.sh
# 用独立项目名 nova-verify、端口 3300，自己生成随机密钥；不读不写 docker/.env。
# 依次验证：构建并启动 → 健康检查 → 初始管理员 → 登录、强制改密 → 上传头像存进 MinIO 并能读回 →
#           备份 → 恢复 → 重启后数据还在。结束时删除这个验证项目的容器、数据卷和备份（KEEP=1 保留）。
set -uo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
work="$(mktemp -d "${TMPDIR:-/tmp}/nova-verify.XXXXXX")"
env_file="$work/verify.env"
port=3300
base="http://localhost:$port"
email="admin@verify.test"
pass_n=0; fail_n=0; results=()
ok() { if [[ "$2" == 1 ]]; then pass_n=$((pass_n+1)); results+=("✓ $1"); echo "✓ $1"; else fail_n=$((fail_n+1)); results+=("✗ $1"); echo "✗ $1"; fi; }
rand() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40; }
cat > "$env_file" <<ENV
COMPOSE_PROJECT_NAME=nova-verify
WEB_PORT=$port
POSTGRES_PASSWORD=$(rand)
MINIO_ROOT_PASSWORD=$(rand)
AUTH_SECRET=$(rand)
ENCRYPTION_KEY=$(rand)
APP_URL=$base
COOKIE_SECURE=false
INITIAL_ADMIN_EMAIL=$email
ENV
dc=(docker compose --env-file "$env_file")
cleanup() {
  if [[ "${KEEP:-0}" == 1 ]]; then echo "KEEP=1：保留项目 nova-verify 和 $work"; return; fi
  "${dc[@]}" down -v --remove-orphans >/dev/null 2>&1
  rm -rf "$work" "${backup_dir:-/nonexistent}"
}
trap cleanup EXIT
command -v docker >/dev/null || { echo "没有 docker"; exit 1; }
if curl -fsS "$base" >/dev/null 2>&1; then echo "端口 $port 已被占用"; exit 1; fi

echo "== 构建并启动（第一次要下载镜像和依赖，可能要几分钟）"
"${dc[@]}" up -d --build > "$work/up.log" 2>&1; ok "构建并启动" $([[ $? == 0 ]] && echo 1 || echo 0) || true
healthy() { for _ in $(seq 1 90); do [[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/api/healthz")" == 200 ]] && return 0; sleep 2; done; return 1; }
healthy; ok "健康检查 /api/healthz 返回 200" $([[ $? == 0 ]] && echo 1 || echo 0)
ok "登录页可访问" $([[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/login")" == 200 ]] && echo 1 || echo 0)
ok "未登录访问接口返回 401" $([[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/api/projects")" == 401 ]] && echo 1 || echo 0)

temp="$("${dc[@]}" logs web 2>/dev/null | sed -n 's/.*临时密码（只显示这一次）：\([^，]*\)，.*/\1/p' | tail -1)"
ok "创建初始管理员（日志里有临时密码）" $([[ -n "$temp" ]] && echo 1 || echo 0)

jar="$work/cookies"
login_body() { printf '{"account":"%s","password":"%s"}' "$email" "$1"; }
change_body() { printf '{"currentPassword":"%s","newPassword":"%s"}' "$1" "$2"; }
post() { curl -s -o "$work/resp" -w '%{http_code}' -b "$jar" -c "$jar" -H "Origin: $base" -H "Content-Type: application/json" -X POST "$base$1" -d "$2"; }
code="$(post /api/auth/login "$(login_body "$temp")")"; ok "用临时密码登录" "$([[ "$code" == 200 ]] && echo 1 || echo 0)"
newpw="Nv-$(rand | cut -c1-16)9a"
code="$(post /api/auth/change-password "$(change_body "$temp" "$newpw")")"; ok "强制修改密码" "$([[ "$code" == 200 ]] && echo 1 || echo 0)"

# 1x1 PNG
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | openssl base64 -d -A > "$work/a.png"
code="$(curl -s -o "$work/resp" -w '%{http_code}' -b "$jar" -c "$jar" -H "Origin: $base" -F "file=@$work/a.png;type=image/png" "$base/api/auth/avatar")"
avatar="$(sed -n 's/.*"avatarUrl":"\([^"]*\)".*/\1/p' "$work/resp")"
ok "上传头像" $([[ "$code" == 200 && -n "$avatar" ]] && echo 1 || echo 0)
avatar_ok() { [[ -n "$avatar" && "$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" "$base$avatar")" == 200 ]]; }
avatar_ok; ok "头像能读回" $([[ $? == 0 ]] && echo 1 || echo 0)
in_bucket="$("${dc[@]}" run --rm --no-deps -T minio-init 'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc ls --recursive "local/$S3_BUCKET/uploads/avatars/"' 2>/dev/null | wc -l | tr -d ' ')"
ok "头像存进了 MinIO 存储桶" $([[ "${in_bucket:-0}" -ge 1 ]] && echo 1 || echo 0)
anon="$("${dc[@]}" exec -T web node -e "fetch('http://minio:9000/'+(process.env.S3_BUCKET)+'/uploads/avatars/').then(r=>console.log(r.status)).catch(()=>console.log(0))" 2>/dev/null | tr -d '\r')"
ok "存储桶不允许匿名访问（MinIO 返回 403）" $([[ "$anon" == 403 ]] && echo 1 || echo 0)

echo "== 备份"
bash docker/backup.sh "$env_file" > "$work/backup.log" 2>&1; bcode=$?
backup_dir="$(sed -n 's/^完成：\(backups\/[^（]*\)（.*/\1/p' "$work/backup.log")"
ok "备份数据库和存储桶" $([[ $bcode == 0 && -s "$backup_dir/db.dump" ]] && echo 1 || echo 0)

# 恢复前改一点数据，恢复后应该回到备份时的样子
post /api/auth/logout "{}" >/dev/null
echo "== 恢复"
RESTORE_CONFIRM=nova-verify bash docker/restore.sh "$backup_dir" "$env_file" > "$work/restore.log" 2>&1; rcode=$?
healthy; ok "恢复后服务正常" $([[ $rcode == 0 && $? == 0 ]] && echo 1 || echo 0)
rm -f "$jar"
code="$(post /api/auth/login "$(login_body "$newpw")")"; ok "恢复后用新密码登录" "$([[ "$code" == 200 ]] && echo 1 || echo 0)"
avatar_ok; ok "恢复后头像还在" $([[ $? == 0 ]] && echo 1 || echo 0)

echo "== 重启（容器重建，数据卷保留）"
"${dc[@]}" down >/dev/null 2>&1 && "${dc[@]}" up -d >/dev/null 2>&1
healthy; ok "重启后服务正常" $([[ $? == 0 ]] && echo 1 || echo 0)
rm -f "$jar"
code="$(post /api/auth/login "$(login_body "$newpw")")"; ok "重启后登录" "$([[ "$code" == 200 ]] && echo 1 || echo 0)"
again="$("${dc[@]}" logs web 2>/dev/null | grep -c '已有系统管理员，跳过')"
ok "重启时不会重复创建管理员" $([[ "$again" -ge 1 ]] && echo 1 || echo 0)

echo; echo "==== 汇总：通过 ${pass_n}，失败 $fail_n ===="
printf '%s\n' "${results[@]}"
if [[ $fail_n -gt 0 ]]; then
  echo; echo "---- web 日志（最后 40 行）----"; "${dc[@]}" logs --tail 40 web 2>/dev/null
  echo "---- 构建 / 备份 / 恢复日志在 ${work}（KEEP=1 时保留）----"
  tail -20 "$work/up.log" 2>/dev/null
fi
