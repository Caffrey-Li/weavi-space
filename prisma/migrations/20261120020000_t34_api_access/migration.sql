-- T34：MCP / 开放接口调用记录
CREATE TABLE "api_access_logs" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_access_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "api_access_logs_enterpriseId_createdAt_idx" ON "api_access_logs"("enterpriseId", "createdAt");
CREATE INDEX "api_access_logs_userId_createdAt_idx" ON "api_access_logs"("userId", "createdAt");
