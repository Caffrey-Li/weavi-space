-- AlterTable
ALTER TABLE "requirements" ADD COLUMN     "docPageId" TEXT,
ADD COLUMN     "proposerId" TEXT;

-- CreateIndex
CREATE INDEX "requirements_docPageId_idx" ON "requirements"("docPageId");

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_docPageId_fkey" FOREIGN KEY ("docPageId") REFERENCES "doc_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

