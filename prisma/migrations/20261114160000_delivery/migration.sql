-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "projectId" TEXT NOT NULL,
    "sourcePageId" TEXT NOT NULL,
    "prdPageId" TEXT,
    "casesPageId" TEXT,
    "prdStatus" TEXT NOT NULL DEFAULT 'none',
    "prdConfirmedVersion" INTEGER,
    "prdConfirmedAt" TIMESTAMP(3),
    "prdConfirmedById" TEXT,
    "casesStatus" TEXT NOT NULL DEFAULT 'none',
    "casesBasisVersion" INTEGER,
    "casesConfirmedVersion" INTEGER,
    "casesConfirmedAt" TIMESTAMP(3),
    "casesConfirmedById" TEXT,
    "prdSkillId" TEXT,
    "casesSkillId" TEXT,
    "credentialId" TEXT,
    "model" TEXT,
    "jobStartedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_messages" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "userId" TEXT,
    "suggestions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_sourcePageId_key" ON "deliveries"("sourcePageId");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_prdPageId_key" ON "deliveries"("prdPageId");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_casesPageId_key" ON "deliveries"("casesPageId");

-- CreateIndex
CREATE INDEX "deliveries_projectId_idx" ON "deliveries"("projectId");

-- CreateIndex
CREATE INDEX "delivery_messages_deliveryId_stage_createdAt_idx" ON "delivery_messages"("deliveryId", "stage", "createdAt");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_messages" ADD CONSTRAINT "delivery_messages_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

