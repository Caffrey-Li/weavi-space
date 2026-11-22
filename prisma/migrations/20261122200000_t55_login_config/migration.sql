-- T55 测试执行自动登录、按前置条件换账号
ALTER TABLE "deliveries" ADD COLUMN "loginConfig" JSONB;
