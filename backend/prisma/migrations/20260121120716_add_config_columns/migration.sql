-- AlterTable
ALTER TABLE "FeePreset" ADD COLUMN     "cardValueCents" INTEGER,
ADD COLUMN     "linkedType" TEXT;

-- AlterTable
ALTER TABLE "ProfessionalCategory" ADD COLUMN     "percentage" DOUBLE PRECISION DEFAULT 100.0;
