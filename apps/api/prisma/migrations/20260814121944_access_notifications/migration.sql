-- CreateEnum
CREATE TYPE "AccessGrantOrigin" AS ENUM ('V2_GENERATED', 'LEGACY_IMPORTED');

-- CreateEnum
CREATE TYPE "AccessGrantStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationTemplate" AS ENUM ('EMAIL_VERIFICATION', 'MIGRATION_INVITATION', 'BOOKING_CONFIRMATION', 'PARTICIPANT_INVITATION', 'PARTICIPANT_PAYMENT_CONFIRMED', 'CREDIT_PACK_PURCHASE_CONFIRMED', 'WALLET_CREDITED', 'INSUFFICIENT_BALANCE_OR_GUARANTEE', 'BOOKING_REMINDER', 'BOOKING_CANCELED', 'REFUND_ISSUED', 'ORGANIZER_REGULARIZATION', 'REGULARIZATION_FAILED', 'SIGNIFICANT_ADMIN_CHANGE');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "access_grants" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "code_ciphertext" TEXT NOT NULL,
    "code_iv" TEXT NOT NULL,
    "origin" "AccessGrantOrigin" NOT NULL,
    "scope" TEXT NOT NULL,
    "status" "AccessGrantStatus" NOT NULL DEFAULT 'PENDING',
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "provisioned_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "provider_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" TEXT NOT NULL,
    "template" "NotificationTemplate" NOT NULL,
    "recipient_user_id" TEXT,
    "recipient_email" TEXT,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "scheduled_for" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_grants_booking_id_idx" ON "access_grants"("booking_id");

-- CreateIndex
CREATE INDEX "access_grants_scope_valid_from_valid_until_idx" ON "access_grants"("scope", "valid_from", "valid_until");

-- CreateIndex
CREATE INDEX "notification_outbox_status_scheduled_for_idx" ON "notification_outbox"("status", "scheduled_for");

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
