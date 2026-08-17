-- CreateEnum
CREATE TYPE "ClientMigrationStatus" AS ENUM ('LEGACY_ONLY', 'INVITED', 'MIGRATION_PENDING', 'MIGRATED', 'DISABLED', 'MERGE_REQUIRED');

-- CreateEnum
CREATE TYPE "LegacySyncKind" AS ENUM ('CLIENTS', 'BOOKINGS');

-- CreateEnum
CREATE TYPE "LegacySyncStatus2" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL');

-- DropIndex
DROP INDEX "legacy_clients_linked_user_id_idx";

-- AlterTable
ALTER TABLE "legacy_clients" ADD COLUMN     "merge_note" TEXT,
ADD COLUMN     "migration_status" "ClientMigrationStatus" NOT NULL DEFAULT 'LEGACY_ONLY';

-- CreateTable
CREATE TABLE "client_migration_invitations" (
    "id" TEXT NOT NULL,
    "legacy_client_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "client_migration_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_bookings" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "court_id" TEXT NOT NULL,
    "legacy_client_id" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "canceled" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "raw_hash" TEXT,

    CONSTRAINT "legacy_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_sync_runs" (
    "id" TEXT NOT NULL,
    "kind" "LegacySyncKind" NOT NULL,
    "status" "LegacySyncStatus2" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "items_seen" INTEGER NOT NULL DEFAULT 0,
    "items_changed" INTEGER NOT NULL DEFAULT 0,
    "error_summary" TEXT,

    CONSTRAINT "legacy_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_migration_invitations_token_hash_key" ON "client_migration_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "client_migration_invitations_legacy_client_id_idx" ON "client_migration_invitations"("legacy_client_id");

-- CreateIndex
CREATE INDEX "legacy_bookings_court_id_start_at_end_at_idx" ON "legacy_bookings"("court_id", "start_at", "end_at");

-- CreateIndex
CREATE INDEX "legacy_bookings_legacy_client_id_idx" ON "legacy_bookings"("legacy_client_id");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_bookings_external_id_court_id_key" ON "legacy_bookings"("external_id", "court_id");

-- CreateIndex
CREATE INDEX "legacy_sync_runs_kind_started_at_idx" ON "legacy_sync_runs"("kind", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_clients_linked_user_id_key" ON "legacy_clients"("linked_user_id");

-- CreateIndex
CREATE INDEX "legacy_clients_migration_status_idx" ON "legacy_clients"("migration_status");

-- AddForeignKey
ALTER TABLE "legacy_clients" ADD CONSTRAINT "legacy_clients_linked_user_id_fkey" FOREIGN KEY ("linked_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_migration_invitations" ADD CONSTRAINT "client_migration_invitations_legacy_client_id_fkey" FOREIGN KEY ("legacy_client_id") REFERENCES "legacy_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legacy_bookings" ADD CONSTRAINT "legacy_bookings_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legacy_bookings" ADD CONSTRAINT "legacy_bookings_legacy_client_id_fkey" FOREIGN KEY ("legacy_client_id") REFERENCES "legacy_clients"("external_id") ON DELETE SET NULL ON UPDATE CASCADE;

