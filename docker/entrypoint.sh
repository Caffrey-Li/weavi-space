#!/bin/sh
# 容器启动：执行数据库迁移（只增量）→ 没有系统管理员时创建初始管理员 → 启动服务
set -e
cd /app
echo "[启动] 执行数据库迁移"
./node_modules/.bin/prisma migrate deploy
./node_modules/.bin/tsx scripts/create-admin.ts
echo "[启动] 启动服务，端口 ${PORT:-3000}"
exec ./node_modules/.bin/next start apps/web -p "${PORT:-3000}"
