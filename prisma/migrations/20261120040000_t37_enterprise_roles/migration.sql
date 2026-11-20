-- T37：企业角色
ALTER TABLE "roles" ADD COLUMN "enterpriseId" TEXT NOT NULL DEFAULT '';
CREATE INDEX "roles_enterpriseId_idx" ON "roles"("enterpriseId");
