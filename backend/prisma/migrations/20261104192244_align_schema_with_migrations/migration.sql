-- DropForeignKey
ALTER TABLE "WorkItem" DROP CONSTRAINT "WorkItem_coProfessionalId_fkey";

-- AlterTable
ALTER TABLE "ActivityType" ADD COLUMN     "baseValue" DECIMAL(10,2),
ADD COLUMN     "cardValue" DECIMAL(10,2),
ADD COLUMN     "roles" JSONB;

-- AlterTable
ALTER TABLE "Payer" ADD COLUMN     "cuit" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cuit" TEXT;

-- AlterTable
ALTER TABLE "WorkItem" DROP COLUMN "coProfessionalId",
DROP COLUMN "eventRole",
ADD COLUMN     "activityTypeId" UUID,
ADD COLUMN     "amountBase" DECIMAL(10,2) NOT NULL,
ADD COLUMN     "amountCard" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "WorkItemParticipant" (
    "id" UUID NOT NULL,
    "workItemId" UUID NOT NULL,
    "professionalId" UUID NOT NULL,
    "roleLabel" TEXT NOT NULL,
    "feeAmount" DECIMAL(10,2) NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItemParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_cuit_key" ON "User"("cuit");

-- AddForeignKey
ALTER TABLE "Professional" ADD CONSTRAINT "Professional_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemParticipant" ADD CONSTRAINT "WorkItemParticipant_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemParticipant" ADD CONSTRAINT "WorkItemParticipant_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
