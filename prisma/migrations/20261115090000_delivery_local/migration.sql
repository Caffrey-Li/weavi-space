-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "featureReqs" JSONB;

-- AlterTable
ALTER TABLE "delivery_runs" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "executor" TEXT NOT NULL DEFAULT 'server';

