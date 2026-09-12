-- DropForeignKey
ALTER TABLE "access_commands" DROP CONSTRAINT "access_commands_zone_id_fkey";

-- AlterTable
ALTER TABLE "automation_zones" ADD COLUMN     "door_after_minutes" INTEGER,
ADD COLUMN     "door_before_minutes" INTEGER,
ADD COLUMN     "light_after_minutes" INTEGER,
ADD COLUMN     "light_before_minutes" INTEGER;

-- AddForeignKey
ALTER TABLE "access_commands" ADD CONSTRAINT "access_commands_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "automation_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
