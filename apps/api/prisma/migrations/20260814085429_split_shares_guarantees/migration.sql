/*
  Warnings:

  - You are about to drop the column `guarantee_type` on the `bookings` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "BookingGuaranteeType" AS ENUM ('CARD_OFF_SESSION', 'WALLET_RESERVE');

-- CreateEnum
CREATE TYPE "BookingGuaranteeStatus" AS ENUM ('ACTIVE', 'PARTIALLY_RELEASED', 'CONSUMED', 'RELEASED', 'FAILED');

-- CreateEnum
CREATE TYPE "BookingShareStatus" AS ENUM ('OPEN', 'INVITED', 'PAYMENT_PENDING', 'PAID', 'COVERED_BY_ORGANIZER', 'CANCELED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "BookingShareFundingSource" AS ENUM ('WALLET', 'EXTERNAL');

-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "guarantee_type";

-- CreateTable
CREATE TABLE "booking_guarantees" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "type" "BookingGuaranteeType" NOT NULL,
    "organizer_user_id" TEXT NOT NULL,
    "guaranteed_amount_cents" INTEGER NOT NULL,
    "remaining_guaranteed_cents" INTEGER NOT NULL,
    "wallet_hold_id" TEXT,
    "payment_method_id" TEXT,
    "status" "BookingGuaranteeStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "booking_guarantees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_shares" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "participant_user_id" TEXT,
    "legacy_client_id" TEXT,
    "invited_email" TEXT,
    "base_amount_cents" INTEGER NOT NULL,
    "service_fee_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "total_amount_cents" INTEGER NOT NULL,
    "status" "BookingShareStatus" NOT NULL DEFAULT 'OPEN',
    "funding_source" "BookingShareFundingSource",
    "paid_by_user_id" TEXT,
    "payment_id" TEXT,
    "wallet_transaction_id" TEXT,
    "invitation_token_hash" TEXT,
    "invitation_expires_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "booking_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_guarantees_booking_id_key" ON "booking_guarantees"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_shares_invitation_token_hash_key" ON "booking_shares"("invitation_token_hash");

-- CreateIndex
CREATE INDEX "booking_shares_booking_id_idx" ON "booking_shares"("booking_id");

-- CreateIndex
CREATE INDEX "booking_shares_participant_user_id_idx" ON "booking_shares"("participant_user_id");

-- AddForeignKey
ALTER TABLE "booking_guarantees" ADD CONSTRAINT "booking_guarantees_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_shares" ADD CONSTRAINT "booking_shares_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
