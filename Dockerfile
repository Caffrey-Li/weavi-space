# 小围空间 Weavi Space 镜像：docker compose 用法见 docker/README.md
# 构建：docker build -t nova-collab .    运行需要 PostgreSQL 16，表结构在启动时用 prisma migrate deploy 执行
# 国内服务器构建时可传镜像源：--build-arg NPM_REGISTRY=https://registry.npmmirror.com
#   --build-arg PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
FROM node:22-bookworm-slim AS base
ARG NPM_REGISTRY=
ARG PRISMA_ENGINES_MIRROR=
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tzdata && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
ENV PRISMA_ENGINES_MIRROR=${PRISMA_ENGINES_MIRROR}
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi
WORKDIR /app

# 依赖：先只拷清单，代码改动不会让这一层失效。postinstall 会跑 prisma generate，所以 schema 也要先拷
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY prisma/schema.prisma prisma/schema.prisma
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

# 运行层：保留完整依赖（启动时要用 prisma CLI 执行迁移、tsx 创建初始管理员）
FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/public/uploads /app/.data && chown -R node:node /app/public/uploads /app/.data \
  && chmod +x /app/docker/entrypoint.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/docker/entrypoint.sh"]
