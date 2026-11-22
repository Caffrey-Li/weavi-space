-- AlterTable
ALTER TABLE "requirements" ADD COLUMN     "iterationId" TEXT,
ADD COLUMN     "number" SERIAL NOT NULL;

-- 已有需求按创建时间重新编号，从 R1001 开始；新需求接着往后排
UPDATE "requirements" r SET "number" = s.rn + 1000 FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "requirements") s WHERE r."id" = s."id";
SELECT setval(pg_get_serial_sequence('"requirements"', 'number'), COALESCE((SELECT MAX("number") FROM "requirements"), 1000) + 1, false);

-- AlterTable
ALTER TABLE "flow_configs" ADD COLUMN     "allowProjectGates" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowProjectMode" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "designStage" BOOLEAN,
ADD COLUMN     "gates" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "mode" TEXT;

-- CreateTable
CREATE TABLE "requirement_tasks" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "requirementId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "assigneeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "startAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "estimate" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "doneAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirement_tasks_pkey" PRIMARY KEY ("id")
);

-- 任务编号从 T1001 开始
SELECT setval(pg_get_serial_sequence('"requirement_tasks"', 'number'), 1001, false);

-- CreateTable
CREATE TABLE "iterations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "capacity" DOUBLE PRECISION,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "iterations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "requirement_tasks_number_key" ON "requirement_tasks"("number");

-- CreateIndex
CREATE INDEX "requirement_tasks_requirementId_sortOrder_idx" ON "requirement_tasks"("requirementId", "sortOrder");

-- CreateIndex
CREATE INDEX "requirement_tasks_assigneeId_status_idx" ON "requirement_tasks"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "iterations_projectId_status_idx" ON "iterations"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "requirements_number_key" ON "requirements"("number");

-- CreateIndex
CREATE INDEX "requirements_iterationId_idx" ON "requirements"("iterationId");

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_iterationId_fkey" FOREIGN KEY ("iterationId") REFERENCES "iterations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_tasks" ADD CONSTRAINT "requirement_tasks_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

