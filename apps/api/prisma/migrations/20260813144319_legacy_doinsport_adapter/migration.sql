-- CreateEnum
CREATE TYPE "CourtType" AS ENUM ('SIMPLE', 'DOUBLE');

-- CreateEnum
CREATE TYPE "LegacySyncStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CONFIRMATION_UNKNOWN', 'FAILED', 'CANCEL_PENDING', 'CANCELED');

-- CreateTable
CREATE TABLE "courts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "court_type" "CourtType" NOT NULL,
    "capacity" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL,
    "legacy_playground_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_court_mapping" (
    "id" TEXT NOT NULL,
    "court_id" TEXT NOT NULL,
    "legacy_playground_id" TEXT NOT NULL,
    "legacy_activity_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legacy_court_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_clients" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'DOINSPORT',
    "external_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "linked_user_id" TEXT,
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "raw_hash" TEXT,

    CONSTRAINT "legacy_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_booking_mappings" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "legacy_booking_id" TEXT,
    "correlation_marker" TEXT NOT NULL,
    "sync_status" "LegacySyncStatus" NOT NULL DEFAULT 'PENDING',
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legacy_booking_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_auth_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legacy_auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courts_slug_key" ON "courts"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "courts_legacy_playground_id_key" ON "courts"("legacy_playground_id");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_court_mapping_court_id_key" ON "legacy_court_mapping"("court_id");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_court_mapping_legacy_playground_id_key" ON "legacy_court_mapping"("legacy_playground_id");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_clients_external_id_key" ON "legacy_clients"("external_id");

-- CreateIndex
CREATE INDEX "legacy_clients_email_idx" ON "legacy_clients"("email");

-- CreateIndex
CREATE INDEX "legacy_clients_linked_user_id_idx" ON "legacy_clients"("linked_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_booking_mappings_booking_id_key" ON "legacy_booking_mappings"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_booking_mappings_correlation_marker_key" ON "legacy_booking_mappings"("correlation_marker");

-- CreateIndex
CREATE INDEX "legacy_booking_mappings_legacy_booking_id_idx" ON "legacy_booking_mappings"("legacy_booking_id");

-- AddForeignKey
ALTER TABLE "legacy_court_mapping" ADD CONSTRAINT "legacy_court_mapping_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
