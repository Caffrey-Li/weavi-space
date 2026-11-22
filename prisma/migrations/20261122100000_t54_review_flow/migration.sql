-- T54 需求评审：评审人配置、多轮、催办、有条件通过落实
ALTER TABLE "flow_configs" ADD COLUMN "reviewerRoles" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "flow_configs" ADD COLUMN "reviewerIds" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "reviews" ADD COLUMN "round" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "reviews" ADD COLUMN "remindedAt" TIMESTAMP(3);
ALTER TABLE "review_votes" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "review_votes" ADD COLUMN "resolvedById" TEXT;
ALTER TABLE "review_votes" ADD COLUMN "resolvedNote" TEXT;
