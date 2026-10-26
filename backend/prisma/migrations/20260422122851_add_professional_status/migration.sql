-- CreateEnum
CREATE TYPE "ProfessionalStatus" AS ENUM ('ACTIVE', 'PENDING');

-- AlterTable
ALTER TABLE "Professional" ADD COLUMN "status" "ProfessionalStatus" NOT NULL DEFAULT 'ACTIVE';
