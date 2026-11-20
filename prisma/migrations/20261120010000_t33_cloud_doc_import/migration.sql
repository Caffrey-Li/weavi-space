-- T33：云文档导入成需求 / Bug、每天自动同步
ALTER TABLE "cloud_doc_links" ADD COLUMN "importAs" TEXT NOT NULL DEFAULT 'doc';
ALTER TABLE "cloud_doc_links" ADD COLUMN "lastAutoAt" TIMESTAMP(3);
ALTER TABLE "cloud_doc_items" ADD COLUMN "requirementId" TEXT;
ALTER TABLE "cloud_doc_items" ADD COLUMN "bugId" TEXT;
