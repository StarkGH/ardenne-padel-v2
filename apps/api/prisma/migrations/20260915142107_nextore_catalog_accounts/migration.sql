-- CreateEnum
CREATE TYPE "NextoreAccountStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'CLOSED', 'VOID', 'ANOMALY');

-- CreateEnum
CREATE TYPE "NextoreSaleLineStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- CreateTable
CREATE TABLE "nextore_pos_categories" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parent_id" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nextore_pos_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nextore_articles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "short_label" TEXT,
    "category_id" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "vat_rate_percent" DECIMAL(5,2) NOT NULL,
    "photo_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "internal_product_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nextore_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nextore_accounts" (
    "id" TEXT NOT NULL,
    "status" "NextoreAccountStatus" NOT NULL DEFAULT 'OPEN',
    "label" TEXT,
    "customer_id" TEXT,
    "opened_by_user_id" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "nextore_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nextore_participants" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "display_name" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),

    CONSTRAINT "nextore_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nextore_sale_lines" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "participant_id" TEXT,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit_price_cents_at_sale" INTEGER NOT NULL,
    "vat_rate_at_sale_percent" DECIMAL(5,2) NOT NULL,
    "operator_user_id" TEXT NOT NULL,
    "status" "NextoreSaleLineStatus" NOT NULL DEFAULT 'ACTIVE',
    "void_reason" TEXT,
    "voided_by_user_id" TEXT,
    "voided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nextore_sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nextore_articles_code_key" ON "nextore_articles"("code");

-- CreateIndex
CREATE INDEX "nextore_articles_category_id_idx" ON "nextore_articles"("category_id");

-- CreateIndex
CREATE INDEX "nextore_accounts_status_idx" ON "nextore_accounts"("status");

-- CreateIndex
CREATE INDEX "nextore_accounts_customer_id_idx" ON "nextore_accounts"("customer_id");

-- CreateIndex
CREATE INDEX "nextore_participants_account_id_idx" ON "nextore_participants"("account_id");

-- CreateIndex
CREATE INDEX "nextore_sale_lines_account_id_idx" ON "nextore_sale_lines"("account_id");

-- CreateIndex
CREATE INDEX "nextore_sale_lines_participant_id_idx" ON "nextore_sale_lines"("participant_id");

-- AddForeignKey
ALTER TABLE "nextore_pos_categories" ADD CONSTRAINT "nextore_pos_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "nextore_pos_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nextore_articles" ADD CONSTRAINT "nextore_articles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "nextore_pos_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nextore_accounts" ADD CONSTRAINT "nextore_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nextore_participants" ADD CONSTRAINT "nextore_participants_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "nextore_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nextore_participants" ADD CONSTRAINT "nextore_participants_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nextore_sale_lines" ADD CONSTRAINT "nextore_sale_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "nextore_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nextore_sale_lines" ADD CONSTRAINT "nextore_sale_lines_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "nextore_articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nextore_sale_lines" ADD CONSTRAINT "nextore_sale_lines_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "nextore_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
