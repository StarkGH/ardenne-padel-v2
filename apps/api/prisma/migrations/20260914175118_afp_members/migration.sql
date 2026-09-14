-- CreateTable
CREATE TABLE "afp_members" (
    "id" TEXT NOT NULL,
    "afp_player_id" INTEGER NOT NULL,
    "license_number" TEXT,
    "full_name" TEXT NOT NULL,
    "gender" TEXT,
    "category" TEXT,
    "points" INTEGER,
    "raw_list_data" JSONB,
    "raw_player_data" JSONB,
    "detail_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "afp_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "afp_members_afp_player_id_key" ON "afp_members"("afp_player_id");
