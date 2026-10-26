-- AlterTable
ALTER TABLE "Professional" ADD COLUMN     "canLoadActivities" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "createdByUserId" UUID;
