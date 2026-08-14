-- CreateEnum
CREATE TYPE "WalletAccountStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('CREDIT_PACK_PURCHASE', 'CREDIT_PACK_BONUS', 'CREDIT_ADMIN', 'DEBIT_BOOKING', 'REFUND_BOOKING', 'HOLD_CREATED', 'HOLD_RELEASED', 'HOLD_CAPTURED', 'ADJUSTMENT', 'BONUS_EXPIRY');

-- CreateEnum
CREATE TYPE "WalletCreditOrigin" AS ENUM ('PAID', 'BONUS', 'ADMIN_COMP');

-- CreateEnum
CREATE TYPE "WalletHoldStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CAPTURED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CreditPackPurchaseStatus" AS ENUM ('PENDING', 'PAID', 'CREDITED', 'FAILED');

-- CreateTable
CREATE TABLE "wallet_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "WalletAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "wallet_account_id" TEXT NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "credit_origin" "WalletCreditOrigin",
    "booking_id" TEXT,
    "credit_pack_purchase_id" TEXT,
    "wallet_hold_id" TEXT,
    "reference" TEXT,
    "created_by" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_holds" (
    "id" TEXT NOT NULL,
    "wallet_account_id" TEXT NOT NULL,
    "booking_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "status" "WalletHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "captured_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),

    CONSTRAINT "wallet_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_packs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purchase_amount_cents" INTEGER NOT NULL,
    "paid_credits_cents" INTEGER NOT NULL,
    "bonus_credits_cents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sales_channels" TEXT[],
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "display_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_pack_purchases" (
    "id" TEXT NOT NULL,
    "credit_pack_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "purchase_amount_cents" INTEGER NOT NULL,
    "paid_credits_cents" INTEGER NOT NULL,
    "bonus_credits_cents" INTEGER NOT NULL,
    "status" "CreditPackPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_pack_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_accounts_user_id_key" ON "wallet_accounts"("user_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_wallet_account_id_idx" ON "wallet_transactions"("wallet_account_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_booking_id_idx" ON "wallet_transactions"("booking_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_credit_pack_purchase_id_idx" ON "wallet_transactions"("credit_pack_purchase_id");

-- CreateIndex
CREATE INDEX "wallet_holds_wallet_account_id_status_idx" ON "wallet_holds"("wallet_account_id", "status");

-- CreateIndex
CREATE INDEX "wallet_holds_booking_id_idx" ON "wallet_holds"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_pack_purchases_payment_id_key" ON "credit_pack_purchases"("payment_id");

-- CreateIndex
CREATE INDEX "credit_pack_purchases_user_id_idx" ON "credit_pack_purchases"("user_id");

-- AddForeignKey
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_account_id_fkey" FOREIGN KEY ("wallet_account_id") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_holds" ADD CONSTRAINT "wallet_holds_wallet_account_id_fkey" FOREIGN KEY ("wallet_account_id") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_pack_purchases" ADD CONSTRAINT "credit_pack_purchases_credit_pack_id_fkey" FOREIGN KEY ("credit_pack_id") REFERENCES "credit_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_pack_purchases" ADD CONSTRAINT "credit_pack_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_pack_purchases" ADD CONSTRAINT "credit_pack_purchases_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
