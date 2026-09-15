-- Lot Nextore G — sessions de caisse (CASH-*)

-- CreateEnum
CREATE TYPE "NextoreCashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "NextoreCashMovementType" AS ENUM ('IN', 'OUT');

-- AlterTable
ALTER TABLE "nextore_payments" ADD COLUMN     "cash_session_id" TEXT;

-- CreateTable
CREATE TABLE "nextore_cash_sessions" (
    "id" TEXT NOT NULL,
    "status" "NextoreCashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "opened_by_user_id" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declared_opening_cents" INTEGER NOT NULL,
    "closed_by_user_id" TEXT,
    "closed_at" TIMESTAMP(3),
    "declared_closing_cents" INTEGER,
    "theoretical_closing_cents" INTEGER,
    "variance_cents" INTEGER,
    "variance_justification" TEXT,

    CONSTRAINT "nextore_cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nextore_cash_movements" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "type" "NextoreCashMovementType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nextore_cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nextore_cash_sessions_status_idx" ON "nextore_cash_sessions"("status");

-- CreateIndex
CREATE INDEX "nextore_cash_movements_session_id_idx" ON "nextore_cash_movements"("session_id");

-- CreateIndex
CREATE INDEX "nextore_payments_cash_session_id_idx" ON "nextore_payments"("cash_session_id");

-- AddForeignKey
ALTER TABLE "nextore_cash_movements" ADD CONSTRAINT "nextore_cash_movements_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "nextore_cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
