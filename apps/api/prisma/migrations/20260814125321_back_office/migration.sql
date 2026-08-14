-- CreateTable
CREATE TABLE "client_notes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_notes_user_id_idx" ON "client_notes"("user_id");

-- AddForeignKey
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
