-- Migration: add article_cards table and make news_articles.body nullable
--
-- Changes:
--   1. Add ArticleCardType PostgreSQL enum
--   2. Make news_articles.body column nullable (new drafts have no body yet)
--   3. Create article_cards table with FK → news_articles (CASCADE DELETE)
--   4. Add composite index (article_id, order) for ordered card fetching

-- 1. ArticleCardType enum
CREATE TYPE "ArticleCardType" AS ENUM ('TEXT', 'QUOTE', 'PUBLICATION', 'IMAGE', 'VIDEO');

-- 2. Make body nullable — existing rows keep their JSON value
ALTER TABLE "news_articles" ALTER COLUMN "body" DROP NOT NULL;

-- 3. article_cards table
CREATE TABLE "article_cards" (
    "id"          TEXT             NOT NULL,
    "article_id"  TEXT             NOT NULL,
    "type"        "ArticleCardType" NOT NULL,
    "order"       INTEGER          NOT NULL,
    "data"        JSONB            NOT NULL,
    "created_at"  TIMESTAMPTZ      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "article_cards_pkey" PRIMARY KEY ("id")
);

-- 4. FK: cascade deletes article cards when the parent article is hard-deleted.
--    Soft-deletes on NewsArticle do NOT cascade — cards remain until hard delete.
ALTER TABLE "article_cards"
    ADD CONSTRAINT "article_cards_article_id_fkey"
    FOREIGN KEY ("article_id") REFERENCES "news_articles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Unique composite index for ordered card listing and position integrity
CREATE UNIQUE INDEX "article_cards_article_id_order_key" ON "article_cards"("article_id", "order");
