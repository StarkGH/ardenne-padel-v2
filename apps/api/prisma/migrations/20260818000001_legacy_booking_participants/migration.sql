-- AlterTable
ALTER TABLE "legacy_bookings" ADD COLUMN     "fully_paid" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "legacy_booking_participants" (
    "id" TEXT NOT NULL,
    "legacy_booking_id" TEXT NOT NULL,
    "legacy_client_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "canceled" BOOLEAN NOT NULL DEFAULT false,
    "active_bookings_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "legacy_booking_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legacy_booking_participants_legacy_booking_id_idx" ON "legacy_booking_participants"("legacy_booking_id");

-- CreateIndex
CREATE INDEX "legacy_booking_participants_legacy_client_id_idx" ON "legacy_booking_participants"("legacy_client_id");

-- AddForeignKey
ALTER TABLE "legacy_booking_participants" ADD CONSTRAINT "legacy_booking_participants_legacy_booking_id_fkey" FOREIGN KEY ("legacy_booking_id") REFERENCES "legacy_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
