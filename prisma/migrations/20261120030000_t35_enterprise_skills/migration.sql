-- T35：企业 skill、参考文件、定制内置能力；测试报告页
ALTER TABLE "user_skills" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "user_skills" ADD COLUMN "enterpriseId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "user_skills" ADD COLUMN "files" JSONB;
ALTER TABLE "user_skills" ADD COLUMN "overrides" TEXT;
ALTER TABLE "user_skills" ADD COLUMN "overrideMode" TEXT;
CREATE INDEX "user_skills_scope_enterpriseId_idx" ON "user_skills"("scope", "enterpriseId");
ALTER TABLE "delivery_runs" ADD COLUMN "reportPageId" TEXT;
