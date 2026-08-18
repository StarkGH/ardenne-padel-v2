-- AlterTable
ALTER TABLE "legacy_booking_participants" ADD COLUMN     "price_cents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "legacy_bookings" ADD COLUMN     "price_due_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "price_received_cents" INTEGER NOT NULL DEFAULT 0;
