-- AlterEnum
ALTER TYPE "AccessCommandStatus" ADD VALUE 'SUCCESS';

-- AlterTable
ALTER TABLE "access_commands" ADD COLUMN     "acked_at" TIMESTAMP(3);
