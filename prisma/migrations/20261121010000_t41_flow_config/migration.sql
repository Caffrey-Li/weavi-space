-- T41 研发流程配置（只加表；没有记录 = 默认流程，已有数据不变）
CREATE TABLE "flow_configs" (
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "hiddenStatuses" TEXT NOT NULL DEFAULT '[]',
    "statusLabels" TEXT NOT NULL DEFAULT '{}',
    "reviewRequired" BOOLEAN,
    "allowProjectStages" BOOLEAN NOT NULL DEFAULT true,
    "allowProjectReview" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_configs_pkey" PRIMARY KEY ("scope","scopeId")
);
