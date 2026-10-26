-- Rename enum value FULLY_PAID to PAID in PaymentStatus
ALTER TYPE "PaymentStatus" RENAME VALUE 'FULLY_PAID' TO 'PAID';
