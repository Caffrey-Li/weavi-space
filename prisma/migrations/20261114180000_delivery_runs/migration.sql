-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "envName" TEXT,
ADD COLUMN     "envUrl" TEXT,
ADD COLUMN     "testPassEnc" TEXT,
ADD COLUMN     "testUser" TEXT;

-- CreateTable
CREATE TABLE "delivery_runs" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'round',
    "round" INTEGER NOT NULL DEFAULT 0,
    "scope" TEXT NOT NULL DEFAULT 'all',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "envName" TEXT,
    "envUrl" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "doneCount" INTEGER NOT NULL DEFAULT 0,
    "currentCode" TEXT,
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "delivery_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_results" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failedStep" INTEGER,
    "message" TEXT,
    "screenshotId" TEXT,
    "durationMs" INTEGER,
    "bugId" TEXT,
    "bugCreated" BOOLEAN NOT NULL DEFAULT false,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "delivery_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_runs_deliveryId_createdAt_idx" ON "delivery_runs"("deliveryId", "createdAt");

-- CreateIndex
CREATE INDEX "delivery_runs_status_createdAt_idx" ON "delivery_runs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "delivery_results_bugId_idx" ON "delivery_results"("bugId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_results_runId_code_key" ON "delivery_results"("runId", "code");

-- AddForeignKey
ALTER TABLE "delivery_runs" ADD CONSTRAINT "delivery_runs_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_results" ADD CONSTRAINT "delivery_results_runId_fkey" FOREIGN KEY ("runId") REFERENCES "delivery_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

