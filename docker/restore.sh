#!/usr/bin/env bash
# 从 backup.sh 的备份恢复：会覆盖当前数据库和存储桶里的内容，恢复期间 web 停止。
# 用法：bash docker/restore.sh <备份目录> [env 文件，默认 docker/.env]
#   需要输入项目名确认；自动化测试可设 RESTORE_CONFIRM=<项目名> 跳过提问。
set -euo pipefail
cd "$(dirname "$0")/.."
dir="${1:?用法：bash docker/restore.sh <备份目录> [env 文件]}"
env_file="${2:-docker/.env}"
[[ -s "$dir/db.dump" && -d "$dir/objects" ]] || { echo "$dir 不是有效的备份目录（缺 db.dump 或 objects/）" >&2; exit 1; }
[[ -f "$env_file" ]] || { echo "找不到 $env_file" >&2; exit 1; }
dc=(docker compose --env-file "$env_file")
project="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$env_file" | tail -1)"; project="${COMPOSE_PROJECT_NAME:-${project:-nova-collab}}"
if [[ "${RESTORE_CONFIRM:-}" != "$project" ]]; then
  echo "将用 $dir 覆盖项目「${project}」的数据库和存储桶。确认请输入项目名："
  read -r answer
  [[ "$answer" == "$project" ]] || { echo "已取消"; exit 1; }
fi
echo "停止 web…"
"${dc[@]}" stop web
echo "恢复数据库…"
# 不用 pg_restore --clean：pg-boss 的分区表在 --clean 时删不掉约束。先清空备份里的 schema（再加 public），再整体恢复
"${dc[@]}" exec -T db sh -c '
  set -e
  pg_restore -l > /tmp/restore.list < /dev/stdin
' < "$dir/db.dump"
"${dc[@]}" exec -T db sh -c '
  set -e
  schemas=$( { echo public; sed -n "s/^[0-9]*; [0-9]* [0-9]* SCHEMA - \([a-z_][a-z0-9_]*\) .*/\1/p" /tmp/restore.list; } | sort -u)
  for sc in $schemas; do psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS \"$sc\" CASCADE"; done
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q -v ON_ERROR_STOP=1 -c "CREATE SCHEMA IF NOT EXISTS public"
  rm -f /tmp/restore.list'
"${dc[@]}" exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-comments --exit-on-error' < "$dir/db.dump"
echo "恢复存储桶…"
"${dc[@]}" run --rm --no-deps -T -v "$PWD/$dir:/backup:ro" minio-init \
  'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc mirror --quiet --overwrite --remove /backup/objects "local/$S3_BUCKET"'
echo "启动 web…"
"${dc[@]}" start web
echo "完成"
