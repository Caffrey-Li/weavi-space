-- CreateTable
CREATE TABLE "cloud_doc_links" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'feishu',
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "parentPageId" TEXT,
    "autoSync" TEXT NOT NULL DEFAULT 'off',
    "lastSyncAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cloud_doc_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloud_doc_items" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "sourceToken" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cloud_doc_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cloud_doc_links_spaceId_idx" ON "cloud_doc_links"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "cloud_doc_items_linkId_sourceToken_key" ON "cloud_doc_items"("linkId", "sourceToken");

-- AddForeignKey
ALTER TABLE "cloud_doc_items" ADD CONSTRAINT "cloud_doc_items_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "cloud_doc_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

