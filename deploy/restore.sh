#!/usr/bin/env bash
# 从 deploy/backup.sh 的备份恢复：覆盖当前数据库、上传文件和 .data。先停服务，恢复完再启动。
# 用法：bash deploy/restore.sh <备份目录>   需要输入数据库名确认；自动化测试可设 RESTORE_CONFIRM=<数据库名>
set -euo pipefail
cd "$(dirname "$0")/.."
dir="${1:?用法：bash deploy/restore.sh <备份目录>}"
[[ -s "$dir/db.dump" && -f "$dir/files.tar.gz" ]] || { echo "$dir 不是有效的备份目录" >&2; exit 1; }
env_file="${ENV_FILE:-.env}"
set -a; source "$env_file"; set +a
db_url="${DATABASE_URL%%\?*}"
db_name="${db_url##*/}"
if [[ "${RESTORE_CONFIRM:-}" != "$db_name" ]]; then
  echo "将用 $dir 覆盖数据库「${db_name}」和上传文件。请先停止服务。确认请输入数据库名："
  read -r answer
  [[ "$answer" == "$db_name" ]] || { echo "已取消"; exit 1; }
fi
# 不用 pg_restore --clean：pg-boss 的分区表在 --clean 时删不掉约束。先清空备份里出现的 schema（再加 public），再整体恢复
schemas="$( { echo public; pg_restore -l "$dir/db.dump" | sed -n 's/^[0-9]*; [0-9]* [0-9]* SCHEMA - \([^ ]*\) .*/\1/p'; } | sort -u)"
for sc in $schemas; do
  [[ "$sc" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "备份里的 schema 名不合法：$sc" >&2; exit 1; }
  psql "$db_url" -X -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS \"$sc\" CASCADE"
done
psql "$db_url" -X -q -v ON_ERROR_STOP=1 -c "CREATE SCHEMA IF NOT EXISTS public"
pg_restore --no-owner --no-comments --exit-on-error -d "$db_url" "$dir/db.dump"
rm -rf public/uploads .data
tar -xzf "$dir/files.tar.gz"
echo "完成，可以启动服务"
