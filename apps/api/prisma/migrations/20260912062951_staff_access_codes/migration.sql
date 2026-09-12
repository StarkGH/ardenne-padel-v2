-- CreateEnum
CREATE TYPE "StaffAccessCodeStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "staff_access_codes" (
    "id" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "code_ciphertext" TEXT NOT NULL,
    "code_iv" TEXT NOT NULL,
    "status" "StaffAccessCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "staff_access_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_access_code_zones" (
    "id" TEXT NOT NULL,
    "code_id" TEXT NOT NULL,
    "zone_id" TEXT NOT NULL,

    CONSTRAINT "staff_access_code_zones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_access_code_zones_code_id_zone_id_key" ON "staff_access_code_zones"("code_id", "zone_id");

-- AddForeignKey
ALTER TABLE "staff_access_code_zones" ADD CONSTRAINT "staff_access_code_zones_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "staff_access_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_access_code_zones" ADD CONSTRAINT "staff_access_code_zones_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "automation_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
