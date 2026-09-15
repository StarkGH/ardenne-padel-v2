-- CreateEnum
CREATE TYPE "NextoreReconciliationStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'AMBIGUOUS');

-- CreateTable
CREATE TABLE "nextore_reconciliation_imports" (
    "id" TEXT NOT NULL,
    "imported_by_user_id" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_filename" TEXT,
    "total_rows" INTEGER NOT NULL,

    CONSTRAINT "nextore_reconciliation_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nextore_reconciliation_entries" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "external_date" TIMESTAMP(3) NOT NULL,
    "external_amount_cents" INTEGER NOT NULL,
    "external_reference" TEXT,
    "status" "NextoreReconciliationStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matched_payment_id" TEXT,
    "matched_by_user_id" TEXT,
    "matched_at" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "nextore_reconciliation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nextore_reconciliation_entries_import_id_idx" ON "nextore_reconciliation_entries"("import_id");

-- CreateIndex
CREATE INDEX "nextore_reconciliation_entries_status_idx" ON "nextore_reconciliation_entries"("status");

-- CreateIndex
CREATE INDEX "nextore_reconciliation_entries_matched_payment_id_idx" ON "nextore_reconciliation_entries"("matched_payment_id");

-- AddForeignKey
ALTER TABLE "nextore_reconciliation_entries" ADD CONSTRAINT "nextore_reconciliation_entries_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "nextore_reconciliation_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
