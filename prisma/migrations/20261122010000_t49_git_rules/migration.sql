-- AlterTable
ALTER TABLE "git_repos" ADD COLUMN     "doneBranches" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "requirePipeline" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "git_links" ADD COLUMN     "closes" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mergeSha" TEXT,
ADD COLUMN     "pending" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "git_links_repoId_pending_idx" ON "git_links"("repoId", "pending");

