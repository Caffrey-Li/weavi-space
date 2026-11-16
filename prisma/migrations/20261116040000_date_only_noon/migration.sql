-- 「只有日期」的字段改为存当天 12:00 UTC（之前多为 00:00 UTC，服务器或浏览器在西半球时会显示成前一天）。
-- 只挪正好落在 00:00:00 UTC 的值，可重复执行；不改表结构。
UPDATE "requirements" SET "startAt" = "startAt" + INTERVAL '12 hours' WHERE "startAt" IS NOT NULL AND "startAt"::time = '00:00:00';
UPDATE "requirements" SET "plannedEndAt" = "plannedEndAt" + INTERVAL '12 hours' WHERE "plannedEndAt" IS NOT NULL AND "plannedEndAt"::time = '00:00:00';
UPDATE "requirements" SET "actualEndAt" = "actualEndAt" + INTERVAL '12 hours' WHERE "actualEndAt" IS NOT NULL AND "actualEndAt"::time = '00:00:00';
UPDATE "bugs" SET "dueAt" = "dueAt" + INTERVAL '12 hours' WHERE "dueAt" IS NOT NULL AND "dueAt"::time = '00:00:00';
UPDATE "releases" SET "plannedAt" = "plannedAt" + INTERVAL '12 hours' WHERE "plannedAt" IS NOT NULL AND "plannedAt"::time = '00:00:00';
UPDATE "projects" SET "plannedEndAt" = "plannedEndAt" + INTERVAL '12 hours' WHERE "plannedEndAt" IS NOT NULL AND "plannedEndAt"::time = '00:00:00';
UPDATE "projects" SET "actualEndAt" = "actualEndAt" + INTERVAL '12 hours' WHERE "actualEndAt" IS NOT NULL AND "actualEndAt"::time = '00:00:00';
