-- Migration: articles
-- Fixes DEFAULT CURRENT_TIMESTAMP on auto-managed timestamp columns that were
-- missing from the original DDL for page_sections and rubrics.
-- body_tsv is a GENERATED ALWAYS column added by the 20260309000002_add_news_fts
-- migration; it must not be re-added here.

-- Align DEFAULT CURRENT_TIMESTAMP on updatedAt columns
ALTER TABLE "page_sections" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "rubrics"       ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
