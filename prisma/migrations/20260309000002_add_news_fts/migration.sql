-- Add a STORED GENERATED tsvector column for Russian full-text search on
-- news_articles. body_text (plain-text extraction of the ProseMirror JSON) is
-- populated on publish, so the vector is only meaningful for PUBLISHED rows.
-- The GIN index makes to_tsvector queries fast even on large tables.

ALTER TABLE "news_articles"
  ADD COLUMN "body_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(body_text, ''))
  ) STORED;

CREATE INDEX "idx_news_fts" ON "news_articles" USING GIN ("body_tsv");
