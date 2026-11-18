-- DropForeignKey
ALTER TABLE "FeeRule" DROP CONSTRAINT "FeeRule_payerId_fkey";

-- AddForeignKey
ALTER TABLE "FeeRule" ADD CONSTRAINT "FeeRule_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
