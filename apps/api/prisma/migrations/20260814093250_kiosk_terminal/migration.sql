-- CreateEnum
CREATE TYPE "KioskDeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "KioskSessionStatus" AS ENUM ('PENDING', 'CLAIMED', 'COMPLETED', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "TerminalDeviceStatus" AS ENUM ('ACTIVE', 'OFFLINE', 'REVOKED');

-- CreateTable
CREATE TABLE "kiosk_devices" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "status" "KioskDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "device_key_hash" TEXT NOT NULL,
    "capabilities" TEXT[],
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "kiosk_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kiosk_checkout_sessions" (
    "id" TEXT NOT NULL,
    "kiosk_device_id" TEXT NOT NULL,
    "court_id" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'FULL',
    "token_hash" TEXT NOT NULL,
    "status" "KioskSessionStatus" NOT NULL DEFAULT 'PENDING',
    "booking_id" TEXT,
    "claimed_by_user_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "kiosk_checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_devices" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "provider_device_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "status" "TerminalDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "capabilities" TEXT[],
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terminal_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_devices_device_key_hash_key" ON "kiosk_devices"("device_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_checkout_sessions_token_hash_key" ON "kiosk_checkout_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_checkout_sessions_booking_id_key" ON "kiosk_checkout_sessions"("booking_id");

-- CreateIndex
CREATE INDEX "kiosk_checkout_sessions_kiosk_device_id_status_idx" ON "kiosk_checkout_sessions"("kiosk_device_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "terminal_devices_provider_device_id_key" ON "terminal_devices"("provider_device_id");

-- AddForeignKey
ALTER TABLE "kiosk_checkout_sessions" ADD CONSTRAINT "kiosk_checkout_sessions_kiosk_device_id_fkey" FOREIGN KEY ("kiosk_device_id") REFERENCES "kiosk_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
