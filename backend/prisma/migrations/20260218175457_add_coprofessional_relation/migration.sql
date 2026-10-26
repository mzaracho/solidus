-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "coProfessionalId" UUID;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_coProfessionalId_fkey" FOREIGN KEY ("coProfessionalId") REFERENCES "Professional"("id") ON DELETE SET NULL ON UPDATE CASCADE;
