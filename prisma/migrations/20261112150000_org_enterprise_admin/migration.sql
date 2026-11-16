-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "adminUserId" TEXT,
ADD COLUMN     "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_adminUserId_key" ON "organizations"("adminUserId");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

