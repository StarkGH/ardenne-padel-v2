-- AlterTable
ALTER TABLE "afp_members" ADD COLUMN     "address" TEXT,
ADD COLUMN     "age_category" TEXT,
ADD COLUMN     "birthdate" TIMESTAMP(3),
ADD COLUMN     "club_name" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "town" TEXT,
ADD COLUMN     "zip" TEXT;
