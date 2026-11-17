-- 演示体验（体验账号类型、到期时间）与个人 Wiki 排版开关：只加列
ALTER TABLE "users" ADD COLUMN "demoKind" TEXT;
ALTER TABLE "users" ADD COLUMN "demoExpiresAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "wikiStyle" BOOLEAN NOT NULL DEFAULT true;
