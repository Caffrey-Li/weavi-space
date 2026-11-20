-- T39：自定义测试脚本、提测自动执行
ALTER TABLE "deliveries" ADD COLUMN "scripts" JSONB;
ALTER TABLE "deliveries" ADD COLUMN "autoRun" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "deliveries" ADD COLUMN "autoRunById" TEXT;
