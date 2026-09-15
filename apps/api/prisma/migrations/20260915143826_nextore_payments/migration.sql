-- CreateEnum
CREATE TYPE "NextorePaymentMethod" AS ENUM ('CASH', 'CARD', 'WALLET_CREDIT');

-- CreateEnum
CREATE TYPE "NextorePaymentStatus" AS ENUM ('PENDING', 'RECORDED', 'FAILED', 'REVERSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WalletTransactionType" ADD VALUE 'DEBIT_NEXTORE_ACCOUNT';
ALTER TYPE "WalletTransactionType" ADD VALUE 'REFUND_NEXTORE_ACCOUNT';

-- AlterTable
ALTER TABLE "wallet_transactions" ADD COLUMN     "nextore_account_id" TEXT;

-- CreateTable
CREATE TABLE "nextore_payments" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "participant_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "method" "NextorePaymentMethod" NOT NULL,
    "status" "NextorePaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "external_reference" TEXT,
    "wallet_transaction_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "recorded_by_user_id" TEXT NOT NULL,
    "reversal_of_payment_id" TEXT,
    "reversed_by_user_id" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nextore_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nextore_payments_idempotency_key_key" ON "nextore_payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "nextore_payments_account_id_idx" ON "nextore_payments"("account_id");

-- CreateIndex
CREATE INDEX "nextore_payments_status_idx" ON "nextore_payments"("status");

-- CreateIndex
CREATE INDEX "wallet_transactions_nextore_account_id_idx" ON "wallet_transactions"("nextore_account_id");

-- AddForeignKey
ALTER TABLE "nextore_payments" ADD CONSTRAINT "nextore_payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "nextore_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
