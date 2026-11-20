-- T38：需求评审
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT,
    "docPageId" TEXT,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "docVersion" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'open',
    "dueAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "review_votes" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL DEFAULT 'pending',
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "review_votes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reviews_requirementId_idx" ON "reviews"("requirementId");
CREATE INDEX "reviews_docPageId_idx" ON "reviews"("docPageId");
CREATE INDEX "reviews_status_createdAt_idx" ON "reviews"("status", "createdAt");
CREATE UNIQUE INDEX "review_votes_reviewId_userId_key" ON "review_votes"("reviewId", "userId");
CREATE INDEX "review_votes_userId_verdict_idx" ON "review_votes"("userId", "verdict");
ALTER TABLE "review_votes" ADD CONSTRAINT "review_votes_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
