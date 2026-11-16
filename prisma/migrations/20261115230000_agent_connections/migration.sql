-- CreateTable
CREATE TABLE "agent_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "clientName" TEXT,
    "clientVersion" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastTestAt" TIMESTAMP(3),
    "testCode" TEXT,
    "testExpiresAt" TIMESTAMP(3),
    "testDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_connections_tokenId_key" ON "agent_connections"("tokenId");

-- CreateIndex
CREATE INDEX "agent_connections_userId_idx" ON "agent_connections"("userId");

-- AddForeignKey
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "api_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

