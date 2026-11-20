-- T40：飞书组织同步的部门对应关系
CREATE TABLE "external_orgs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'feishu',
    "scope" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "external_orgs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "external_orgs_provider_scope_externalId_key" ON "external_orgs"("provider", "scope", "externalId");
CREATE INDEX "external_orgs_orgId_idx" ON "external_orgs"("orgId");
