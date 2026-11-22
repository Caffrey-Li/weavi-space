-- CreateTable
CREATE TABLE "git_connections" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT 'gitlab',
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "tokenEnc" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "allowWrite" BOOLEAN NOT NULL DEFAULT false,
    "accountName" TEXT,
    "lastCheckAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "git_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "git_repos" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "remoteId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "webUrl" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "webhookSecretHash" TEXT NOT NULL,
    "afterMerge" TEXT NOT NULL DEFAULT 'dev_done',
    "tagPattern" TEXT DEFAULT 'v{version}',
    "lastWebhookAt" TIMESTAMP(3),
    "lastPollAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "git_repos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "git_links" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "author" TEXT,
    "state" TEXT,
    "sourceBranch" TEXT,
    "targetBranch" TEXT,
    "requirementId" TEXT,
    "taskId" TEXT,
    "happenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "git_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "git_events" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'webhook',
    "summary" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "git_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "git_connections_scope_idx" ON "git_connections"("scope");

-- CreateIndex
CREATE INDEX "git_repos_connectionId_idx" ON "git_repos"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "git_repos_projectId_remoteId_key" ON "git_repos"("projectId", "remoteId");

-- CreateIndex
CREATE UNIQUE INDEX "git_links_key_key" ON "git_links"("key");

-- CreateIndex
CREATE INDEX "git_links_requirementId_idx" ON "git_links"("requirementId");

-- CreateIndex
CREATE INDEX "git_links_taskId_idx" ON "git_links"("taskId");

-- CreateIndex
CREATE INDEX "git_links_repoId_kind_ref_idx" ON "git_links"("repoId", "kind", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "git_events_eventKey_key" ON "git_events"("eventKey");

-- CreateIndex
CREATE INDEX "git_events_repoId_createdAt_idx" ON "git_events"("repoId", "createdAt");

-- AddForeignKey
ALTER TABLE "git_repos" ADD CONSTRAINT "git_repos_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "git_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "git_links" ADD CONSTRAINT "git_links_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "git_repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

