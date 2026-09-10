-- CreateEnum
CREATE TYPE "ZoneType" AS ENUM ('DOOR', 'LIGHT', 'GENERIC');

-- CreateEnum
CREATE TYPE "AccessDeviceType" AS ENUM ('RASPBERRY_ACCESS_CONTROLLER');

-- CreateEnum
CREATE TYPE "AccessDeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "AccessCommandType" AS ENUM ('OPEN_DOOR_PULSE', 'LIGHT_OVERRIDE_ON', 'LIGHT_OVERRIDE_OFF', 'CLEAR_LIGHT_OVERRIDE');

-- CreateEnum
CREATE TYPE "AccessCommandStatus" AS ENUM ('PENDING', 'DELIVERED', 'EXPIRED');

-- CreateTable
CREATE TABLE "automation_zones" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "ZoneType" NOT NULL,
    "label" TEXT NOT NULL,
    "court_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_devices" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccessDeviceType" NOT NULL DEFAULT 'RASPBERRY_ACCESS_CONTROLLER',
    "device_key_hash" TEXT NOT NULL,
    "status" "AccessDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_seen_at" TIMESTAMP(3),
    "last_sync_revision" TEXT,
    "last_heartbeat" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "access_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_device_events" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_device_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_commands" (
    "id" TEXT NOT NULL,
    "zone_id" TEXT NOT NULL,
    "device_id" TEXT,
    "type" "AccessCommandType" NOT NULL,
    "status" "AccessCommandStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automation_zones_key_key" ON "automation_zones"("key");

-- CreateIndex
CREATE UNIQUE INDEX "access_devices_device_key_hash_key" ON "access_devices"("device_key_hash");

-- CreateIndex
CREATE INDEX "access_device_events_device_id_occurred_at_idx" ON "access_device_events"("device_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "access_device_events_device_id_event_id_key" ON "access_device_events"("device_id", "event_id");

-- CreateIndex
CREATE INDEX "access_commands_zone_id_status_idx" ON "access_commands"("zone_id", "status");

-- AddForeignKey
ALTER TABLE "automation_zones" ADD CONSTRAINT "automation_zones_court_id_fkey" FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_device_events" ADD CONSTRAINT "access_device_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "access_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_commands" ADD CONSTRAINT "access_commands_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "automation_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_commands" ADD CONSTRAINT "access_commands_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "access_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
