-- CreateEnum
CREATE TYPE "CourtClosureType" AS ENUM ('MAINTENANCE', 'EVENT', 'ADMIN_BLOCK');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('DRAFT', 'CHECKOUT_PENDING', 'LEGACY_HOLD_PENDING', 'PAYMENT_PENDING', 'CONFIRMED', 'CANCEL_PENDING', 'CANCELED', 'COMPLETED', 'FAILED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NONE', 'PENDING', 'PARTIALLY_PAID', 'PAID', 'GUARANTEE_ACTIVE', 'FAILED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'AMOUNT_DUE');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('FULL', 'SPLIT');

-- CreateEnum
CREATE TYPE "SplitServiceFeeAllocation" AS ENUM ('ORGANIZER', 'PRO_RATA');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('WEB', 'PWA', 'ADMIN', 'MIGRATION', 'LEGACY_SYNC', 'API_FUTURE');

-- CreateEnum
CREATE TYPE "BookingParticipantRole" AS ENUM ('ORGANIZER', 'PLAYER');

-- CreateEnum
CREATE TYPE "BookingParticipantStatus" AS ENUM ('INVITED', 'CONFIRMED', 'REMOVED');

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'BLOCKED');

-- CreateTable
CREATE TABLE "opening_rules" (
    "id" TEXT NOT NULL,
    "court_id" TEXT,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opening_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "court_closures" (
    "id" TEXT NOT NULL,
    "court_id" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "closure_type" "CourtClosureType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "court_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duration_rules" (
    "id" TEXT NOT NULL,
    "court_id" TEXT,
    "court_type" "CourtType",
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "allowed_durations_minutes" INTEGER[],
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duration_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "court_id" TEXT,
    "court_type" "CourtType",
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "days_of_week" INTEGER[],
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "price_total_cents" INTEGER,
    "price_per_participant_cents" INTEGER,
    "reference_capacity" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL,
    "tags" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tariff_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "organizer_user_id" TEXT NOT NULL,
    "court_id" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'DRAFT',
    "legacy_sync_status" "LegacySyncStatus",
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'NONE',
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'FULL',
    "booking_base_price_cents" INTEGER NOT NULL,
    "split_service_fee_cents" INTEGER,
    "split_service_fee_allocation" "SplitServiceFeeAllocation",
    "price_total_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "source" "BookingSource" NOT NULL DEFAULT 'WEB',
    "access_status" TEXT,
    "guarantee_type" TEXT,
    "cancellation_deadline" TIMESTAMP(3),
    "tariff_rule_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_participants" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "user_id" TEXT,
    "legacy_client_id" TEXT,
    "invited_email" TEXT,
    "display_name" TEXT NOT NULL,
    "role" "BookingParticipantRole" NOT NULL DEFAULT 'PLAYER',
    "status" "BookingParticipantStatus" NOT NULL DEFAULT 'INVITED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friendships" (
    "id" TEXT NOT NULL,
    "requester_user_id" TEXT NOT NULL,
    "addressee_user_id" TEXT NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opening_rules_court_id_idx" ON "opening_rules"("court_id");

-- CreateIndex
CREATE INDEX "court_closures_court_id_start_at_end_at_idx" ON "court_closures"("court_id", "start_at", "end_at");

-- CreateIndex
CREATE INDEX "duration_rules_court_id_idx" ON "duration_rules"("court_id");

-- CreateIndex
CREATE INDEX "tariff_rules_court_id_active_idx" ON "tariff_rules"("court_id", "active");

-- CreateIndex
CREATE INDEX "bookings_court_id_start_at_end_at_idx" ON "bookings"("court_id", "start_at", "end_at");

-- CreateIndex
CREATE INDEX "bookings_organizer_user_id_idx" ON "bookings"("organizer_user_id");

-- CreateIndex
CREATE INDEX "booking_participants_booking_id_idx" ON "booking_participants"("booking_id");

-- CreateIndex
CREATE INDEX "booking_participants_user_id_idx" ON "booking_participants"("user_id");

-- CreateIndex
CREATE INDEX "friendships_addressee_user_id_idx" ON "friendships"("addressee_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "friendships_requester_user_id_addressee_user_id_key" ON "friendships"("requester_user_id", "addressee_user_id");

-- AddForeignKey
ALTER TABLE "legacy_booking_mappings" ADD CONSTRAINT "legacy_booking_mappings_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_rules" ADD CONSTRAINT "opening_rules_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "court_closures" ADD CONSTRAINT "court_closures_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duration_rules" ADD CONSTRAINT "duration_rules_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_rules" ADD CONSTRAINT "tariff_rules_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organizer_user_id_fkey" FOREIGN KEY ("organizer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_participants" ADD CONSTRAINT "booking_participants_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
