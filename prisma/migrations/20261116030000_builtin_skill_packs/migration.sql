-- CreateTable
CREATE TABLE "builtin_skill_packs" (
    "skill" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "commit" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,

    CONSTRAINT "builtin_skill_packs_pkey" PRIMARY KEY ("skill")
);
