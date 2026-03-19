-- DropIndex
DROP INDEX "idx_news_fts";

-- AlterTable
ALTER TABLE "article_cards" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "news_articles" ALTER COLUMN "body_tsv" DROP DEFAULT;
