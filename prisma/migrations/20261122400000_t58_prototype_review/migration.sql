-- T58 需求交付：原型、AI 评审
ALTER TABLE "deliveries" ADD COLUMN "protoStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "deliveries" ADD COLUMN "protoSkillId" TEXT;
ALTER TABLE "deliveries" ADD COLUMN "protoAttachmentId" TEXT;
ALTER TABLE "deliveries" ADD COLUMN "protoVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "deliveries" ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "deliveries" ADD COLUMN "reviewPageId" TEXT;
