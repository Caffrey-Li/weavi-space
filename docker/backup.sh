#!/usr/bin/env bash
# 备份 Docker 部署：数据库（pg_dump 自定义格式）+ 存储桶全部对象。服务不用停。
# 用法：bash docker/backup.sh [env 文件，默认 docker/.env]   结果在 backups/<时间>/
set -euo pipefail
cd "$(dirname "$0")/.."
env_file="${1:-docker/.env}"
[[ -f "$env_file" ]] || { echo "找不到 $env_file" >&2; exit 1; }
dc=(docker compose --env-file "$env_file")
dir="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$dir"
echo "备份数据库…"
"${dc[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$dir/db.dump"
[[ -s "$dir/db.dump" ]] || { echo "数据库备份为空，失败" >&2; exit 1; }
echo "备份存储桶…"
"${dc[@]}" run --rm --no-deps -T -v "$PWD/$dir:/backup" minio-init \
  'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mkdir -p /backup/objects && mc mirror --quiet "local/$S3_BUCKET" /backup/objects'
echo "完成：${dir}（数据库 $(du -h "$dir/db.dump" | cut -f1)，对象 $(find "$dir/objects" -type f | wc -l | tr -d ' ') 个）"
