-- AlterTable
ALTER TABLE "agent_tasks" ADD COLUMN     "maxSteps" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "maxTokens" INTEGER NOT NULL DEFAULT 200000,
ADD COLUMN     "ruleId" TEXT,
ADD COLUMN     "trigger" JSONB;

-- CreateTable
CREATE TABLE "agent_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enterpriseId" TEXT,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "triggerType" TEXT NOT NULL,
    "event" TEXT,
    "eventStatus" TEXT,
    "freq" TEXT,
    "weekday" INTEGER,
    "time" TEXT,
    "projectId" TEXT,
    "prompt" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "lastSlot" TEXT,
    "lastStatus" TEXT,
    "lastNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_rules_userId_createdAt_idx" ON "agent_rules"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_rules_enabled_triggerType_idx" ON "agent_rules"("enabled", "triggerType");

-- CreateIndex
CREATE INDEX "agent_tasks_ruleId_createdAt_idx" ON "agent_tasks"("ruleId", "createdAt");

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "agent_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
