#!/usr/bin/env bash
# 直接安装的备份：数据库（pg_dump 自定义格式）+ 上传文件（public/uploads）+ 加密配置（.data）。服务不用停。
# 用法：bash deploy/backup.sh [备份根目录，默认 backups]   需要 pg_dump（与 PostgreSQL 16 同版本）
set -euo pipefail
cd "$(dirname "$0")/.."
env_file="${ENV_FILE:-.env}"
set -a; source "$env_file"; set +a
command -v pg_dump >/dev/null || { echo "没有 pg_dump" >&2; exit 1; }
dir="${1:-backups}/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$dir"
db_url="${DATABASE_URL%%\?*}"   # 去掉 ?schema= 之类 Prisma 专用参数
pg_dump -Fc -f "$dir/db.dump" "$db_url"
[[ -s "$dir/db.dump" ]] || { echo "数据库备份为空" >&2; exit 1; }
mkdir -p public/uploads .data
tar -czf "$dir/files.tar.gz" public/uploads .data
chmod 600 "$dir"/*
echo "完成：${dir}（数据库 $(du -h "$dir/db.dump" | cut -f1)，文件 $(du -h "$dir/files.tar.gz" | cut -f1)）"
