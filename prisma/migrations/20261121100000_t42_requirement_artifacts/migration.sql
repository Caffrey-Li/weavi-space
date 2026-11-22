-- CreateTable
CREATE TABLE "requirement_artifacts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "requirementId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "attachmentId" TEXT,
    "docPageId" TEXT,
    "note" TEXT,
    "shareToChildren" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirement_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "requirement_artifacts_requirementId_kind_idx" ON "requirement_artifacts"("requirementId", "kind");

-- CreateIndex
CREATE INDEX "requirement_artifacts_workspaceId_idx" ON "requirement_artifacts"("workspaceId");

-- AddForeignKey
ALTER TABLE "requirement_artifacts" ADD CONSTRAINT "requirement_artifacts_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

