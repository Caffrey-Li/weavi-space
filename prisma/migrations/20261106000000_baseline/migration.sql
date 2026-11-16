-- 基线迁移（11-06 SQLite → PostgreSQL 16）：建全部表，并建好默认工作区 ws_default。
-- 旧库数据用 scripts/migrate-sqlite-to-pg.ts 搬过来。

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "globalRole" TEXT NOT NULL DEFAULT 'member',
    "position" TEXT,
    "feishuOpenId" TEXT,
    "feishuUnionId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "orgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "enterpriseId" TEXT,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "systemName" TEXT NOT NULL,
    "iconUrl" TEXT,
    "coverUrl" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "plannedEndAt" TIMESTAMP(3),
    "actualEndAt" TIMESTAMP(3),
    "launchNotes" TEXT,
    "useCustomColumns" BOOLEAN NOT NULL DEFAULT false,
    "productId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "prevStatus" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "archivedVia" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deletedVia" TEXT,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_covers" (
    "projectId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_covers_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_resources" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirements" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "descriptionHtml" TEXT,
    "docUrl" TEXT,
    "projectId" TEXT,
    "parentId" TEXT,
    "productId" TEXT,
    "productNodeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'req_in_progress',
    "priority" TEXT NOT NULL DEFAULT 'p2',
    "creatorId" TEXT NOT NULL,
    "boardOrder" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT,
    "externalKey" TEXT,
    "startAt" TIMESTAMP(3),
    "plannedEndAt" TIMESTAMP(3),
    "actualEndAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "archivedById" TEXT,
    "archivedVia" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deletedVia" TEXT,

    CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_comments" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirement_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "ownerType" TEXT NOT NULL DEFAULT 'requirement',
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "enterpriseId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'maintaining',
    "ownerId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "environments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "prevStatus" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "archivedVia" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deletedVia" TEXT,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_intros" (
    "productId" TEXT NOT NULL,
    "html" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_intros_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "product_architectures" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'custom',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_architectures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_nodes" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'menu',
    "name" TEXT NOT NULL,
    "code" TEXT,
    "ownerId" TEXT,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_assignees" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirement_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bugs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "descriptionHtml" TEXT,
    "docUrl" TEXT,
    "projectId" TEXT,
    "requirementId" TEXT,
    "productId" TEXT,
    "productNodeId" TEXT,
    "environment" TEXT,
    "device" TEXT,
    "foundVersion" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "severity" TEXT NOT NULL DEFAULT 'major',
    "assigneeId" TEXT,
    "frontendId" TEXT,
    "backendId" TEXT,
    "creatorId" TEXT NOT NULL,
    "boardOrder" INTEGER NOT NULL DEFAULT 0,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "archivedById" TEXT,
    "archivedVia" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deletedVia" TEXT,

    CONSTRAINT "bugs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bug_comments" (
    "id" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bug_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "releases" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "projectId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "plannedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'normal',
    "scheduleId" TEXT,
    "reason" TEXT,

    CONSTRAINT "releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_schedules" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "weekday" INTEGER NOT NULL DEFAULT 4,
    "monthDay" INTEGER NOT NULL DEFAULT 0,
    "anchorDate" TEXT,
    "releaseTime" TEXT,
    "versionPattern" TEXT NOT NULL DEFAULT '{yyyy}.{MM}.{dd}',
    "titlePattern" TEXT,
    "horizon" INTEGER NOT NULL DEFAULT 2,
    "freezeDays" INTEGER NOT NULL DEFAULT 0,
    "generatedUntil" TEXT,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "release_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_bugs" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_bugs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_requirements" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dataScope" TEXT NOT NULL DEFAULT 'involved',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'project',
    "role" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_pages" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "groupId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "draftTitle" TEXT,
    "draftBody" TEXT,
    "draftUpdatedAt" TIMESTAMP(3),
    "statusTag" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "creatorId" TEXT NOT NULL,
    "updatedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "archivedVia" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deletedVia" TEXT,

    CONSTRAINT "doc_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_groups" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doc_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_page_versions" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_page_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_page_stars" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_page_stars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_page_links" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "requirementId" TEXT,
    "bugId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'body',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_page_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feishu_table_links" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "tableName" TEXT,
    "headerRow" INTEGER NOT NULL DEFAULT 1,
    "projectId" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT 'requirement',
    "productId" TEXT,
    "autoSync" TEXT NOT NULL DEFAULT 'off',
    "autoEvery" INTEGER NOT NULL DEFAULT 60,
    "lastAutoAt" TIMESTAMP(3),
    "mapping" TEXT NOT NULL DEFAULT '{}',
    "appendOnPush" BOOLEAN NOT NULL DEFAULT true,
    "pushFields" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "lastPullAt" TIMESTAMP(3),
    "lastPushAt" TIMESTAMP(3),
    "lastPull" TEXT,
    "lastPush" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feishu_table_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feishu_table_rows" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "sig" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feishu_table_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_bots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "webhookEnc" TEXT,
    "secretEnc" TEXT,
    "webhookOn" BOOLEAN NOT NULL DEFAULT false,
    "dmOn" BOOLEAN NOT NULL DEFAULT false,
    "events" TEXT NOT NULL DEFAULT '[]',
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_schedules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'digest',
    "message" TEXT,
    "time" TEXT NOT NULL DEFAULT '09:00',
    "weekdays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "channel" TEXT NOT NULL DEFAULT 'both',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "users_workspaceId_idx" ON "users"("workspaceId");

-- CreateIndex
CREATE INDEX "users_orgId_idx" ON "users"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_feishuOpenId_key" ON "users"("feishuOpenId");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "organizations_workspaceId_idx" ON "organizations"("workspaceId");

-- CreateIndex
CREATE INDEX "organizations_parentId_sortOrder_idx" ON "organizations"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "projects_workspaceId_idx" ON "projects"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_key_key" ON "projects"("key");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_projectId_userId_key" ON "project_members"("projectId", "userId");

-- CreateIndex
CREATE INDEX "project_resources_projectId_sortOrder_idx" ON "project_resources"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "requirements_workspaceId_idx" ON "requirements"("workspaceId");

-- CreateIndex
CREATE INDEX "requirements_projectId_status_boardOrder_idx" ON "requirements"("projectId", "status", "boardOrder");

-- CreateIndex
CREATE INDEX "requirements_parentId_idx" ON "requirements"("parentId");

-- CreateIndex
CREATE INDEX "requirements_productId_productNodeId_idx" ON "requirements"("productId", "productNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "requirements_externalKey_key" ON "requirements"("externalKey");

-- CreateIndex
CREATE INDEX "requirement_comments_requirementId_createdAt_idx" ON "requirement_comments"("requirementId", "createdAt");

-- CreateIndex
CREATE INDEX "attachments_workspaceId_idx" ON "attachments"("workspaceId");

-- CreateIndex
CREATE INDEX "attachments_ownerType_ownerId_idx" ON "attachments"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "products_workspaceId_idx" ON "products"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE INDEX "product_architectures_productId_createdAt_idx" ON "product_architectures"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "product_nodes_productId_parentId_sortOrder_idx" ON "product_nodes"("productId", "parentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "requirement_assignees_requirementId_role_key" ON "requirement_assignees"("requirementId", "role");

-- CreateIndex
CREATE INDEX "bugs_workspaceId_idx" ON "bugs"("workspaceId");

-- CreateIndex
CREATE INDEX "bugs_projectId_status_boardOrder_idx" ON "bugs"("projectId", "status", "boardOrder");

-- CreateIndex
CREATE INDEX "bug_comments_bugId_createdAt_idx" ON "bug_comments"("bugId", "createdAt");

-- CreateIndex
CREATE INDEX "releases_workspaceId_idx" ON "releases"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "releases_projectId_version_key" ON "releases"("projectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "release_schedules_projectId_key" ON "release_schedules"("projectId");

-- CreateIndex
CREATE INDEX "release_bugs_bugId_idx" ON "release_bugs"("bugId");

-- CreateIndex
CREATE UNIQUE INDEX "release_bugs_releaseId_bugId_key" ON "release_bugs"("releaseId", "bugId");

-- CreateIndex
CREATE UNIQUE INDEX "release_requirements_releaseId_requirementId_key" ON "release_requirements"("releaseId", "requirementId");

-- CreateIndex
CREATE INDEX "activity_logs_workspaceId_idx" ON "activity_logs"("workspaceId");

-- CreateIndex
CREATE INDEX "activity_logs_entityType_entityId_createdAt_idx" ON "activity_logs"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "positions_key_key" ON "positions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_scope_role_feature_key" ON "role_permissions"("scope", "role", "feature");

-- CreateIndex
CREATE INDEX "doc_pages_workspaceId_idx" ON "doc_pages"("workspaceId");

-- CreateIndex
CREATE INDEX "doc_pages_projectId_parentId_sortOrder_idx" ON "doc_pages"("projectId", "parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "doc_groups_projectId_sortOrder_idx" ON "doc_groups"("projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "doc_page_versions_pageId_version_key" ON "doc_page_versions"("pageId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "doc_page_stars_pageId_userId_key" ON "doc_page_stars"("pageId", "userId");

-- CreateIndex
CREATE INDEX "doc_page_links_pageId_idx" ON "doc_page_links"("pageId");

-- CreateIndex
CREATE INDEX "feishu_table_links_workspaceId_idx" ON "feishu_table_links"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "feishu_table_rows_linkId_rowKey_key" ON "feishu_table_rows"("linkId", "rowKey");

-- CreateIndex
CREATE UNIQUE INDEX "feishu_table_rows_linkId_requirementId_key" ON "feishu_table_rows"("linkId", "requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "user_bots_userId_key" ON "user_bots"("userId");

-- CreateIndex
CREATE INDEX "user_schedules_userId_idx" ON "user_schedules"("userId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_covers" ADD CONSTRAINT "project_covers_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_resources" ADD CONSTRAINT "project_resources_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_productNodeId_fkey" FOREIGN KEY ("productNodeId") REFERENCES "product_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_comments" ADD CONSTRAINT "requirement_comments_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_comments" ADD CONSTRAINT "requirement_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_intros" ADD CONSTRAINT "product_intros_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_architectures" ADD CONSTRAINT "product_architectures_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_nodes" ADD CONSTRAINT "product_nodes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_nodes" ADD CONSTRAINT "product_nodes_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_nodes" ADD CONSTRAINT "product_nodes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "product_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_assignees" ADD CONSTRAINT "requirement_assignees_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_assignees" ADD CONSTRAINT "requirement_assignees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_productNodeId_fkey" FOREIGN KEY ("productNodeId") REFERENCES "product_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_frontendId_fkey" FOREIGN KEY ("frontendId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_backendId_fkey" FOREIGN KEY ("backendId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug_comments" ADD CONSTRAINT "bug_comments_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "bugs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug_comments" ADD CONSTRAINT "bug_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_bugs" ADD CONSTRAINT "release_bugs_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_requirements" ADD CONSTRAINT "release_requirements_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_requirements" ADD CONSTRAINT "release_requirements_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_pages" ADD CONSTRAINT "doc_pages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_pages" ADD CONSTRAINT "doc_pages_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "doc_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_pages" ADD CONSTRAINT "doc_pages_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_pages" ADD CONSTRAINT "doc_pages_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_pages" ADD CONSTRAINT "doc_pages_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_page_versions" ADD CONSTRAINT "doc_page_versions_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "doc_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_page_versions" ADD CONSTRAINT "doc_page_versions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_page_stars" ADD CONSTRAINT "doc_page_stars_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "doc_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_page_stars" ADD CONSTRAINT "doc_page_stars_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_page_links" ADD CONSTRAINT "doc_page_links_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "doc_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_page_links" ADD CONSTRAINT "doc_page_links_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_page_links" ADD CONSTRAINT "doc_page_links_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "bugs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feishu_table_links" ADD CONSTRAINT "feishu_table_links_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 默认工作区：现有数据都归入这里（业务表 workspaceId 的默认值）
INSERT INTO "workspaces" ("id", "slug", "name", "createdAt", "updatedAt") VALUES ('ws_default', 'default', '默认工作区', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
