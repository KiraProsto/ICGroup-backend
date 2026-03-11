-- Migration: add_content_metadata
-- Extends Page, PageSection, and NewsArticle with fields required by the CMS
-- design (article type, rubric, view count, excerpt block, social meta,
-- RSS toggles, publication index, advertisement block) and adds the missing
-- Rubric lookup table.  All changes are additive and non-destructive.
--
-- Adds rollout-safe enum changes and composite indexes that match CMS list
-- queries (status + optional taxonomy filter + publication_index sort).

-- ─────────────────────────────────────────────
--  1. New enum: ArticleType
-- ─────────────────────────────────────────────

CREATE TYPE "ArticleType" AS ENUM (
  'NEWS',
  'ARTICLE',
  'PRESS_RELEASE',
  'INTERVIEW',
  'ANNOUNCEMENT'
);

-- ─────────────────────────────────────────────
--  2. AuditResourceType — add PageSection and Rubric values
--  Append values in-place to avoid rewriting the hot audit_logs table.
-- ─────────────────────────────────────────────

ALTER TYPE "AuditResourceType" ADD VALUE IF NOT EXISTS 'PageSection';
ALTER TYPE "AuditResourceType" ADD VALUE IF NOT EXISTS 'Rubric';

-- ─────────────────────────────────────────────
--  3. Rubric lookup table
-- ─────────────────────────────────────────────

CREATE TABLE "rubrics" (
  "id"         TEXT         NOT NULL,
  "name"       TEXT         NOT NULL,
  "slug"       TEXT         NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rubrics_pkey" PRIMARY KEY ("id")
);

-- Unique constraint drives the B-tree lookup; the explicit index below is kept
-- for documentation clarity — PostgreSQL will use the unique index for scans.
CREATE UNIQUE INDEX "rubrics_slug_key" ON "rubrics" ("slug");

-- ─────────────────────────────────────────────
--  4. PageSection — add audit timestamps
--     (created_at / updated_at were missing from the original DDL)
-- ─────────────────────────────────────────────

ALTER TABLE "page_sections"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ─────────────────────────────────────────────
--  5. NewsArticle — add all content-metadata columns
-- ─────────────────────────────────────────────

ALTER TABLE "news_articles"
  -- Classification
  ADD COLUMN "article_type"      "ArticleType" NOT NULL DEFAULT 'NEWS',
  ADD COLUMN "rubric_id"         TEXT,
  -- Excerpt / Анонс block
  ADD COLUMN "excerpt_title"     TEXT,
  ADD COLUMN "excerpt_image"     TEXT,
  -- Social-media meta (JSONB): { facebook, vk, telegram, seo }
  -- Each key: { title: string, text: string, imageUrl: string }
  ADD COLUMN "social_meta"       JSONB,
  -- RSS distribution toggles
  ADD COLUMN "rss_google_news"   BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN "rss_yandex_dzen"   BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN "rss_yandex_news"   BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN "rss_default"       BOOLEAN       NOT NULL DEFAULT false,
  -- Editorial
  ADD COLUMN "publication_index" INTEGER       NOT NULL DEFAULT 500,
  ADD COLUMN "view_count"        INTEGER       NOT NULL DEFAULT 0,
  -- Advertisement block
  ADD COLUMN "ad_banner_code"    TEXT,
  ADD COLUMN "ad_banner_image"   TEXT;

-- FK: news_articles.rubric_id → rubrics.id  (SET NULL on rubric deletion)
ALTER TABLE "news_articles"
  ADD CONSTRAINT "news_articles_rubric_id_fkey"
  FOREIGN KEY ("rubric_id")
  REFERENCES "rubrics" ("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
--  6. Indexes — hot list-query paths
-- ─────────────────────────────────────────────

-- pages: FK + status filter (list queries always filter by status)
CREATE INDEX "pages_status_idx"     ON "pages" ("status");
CREATE INDEX "pages_created_by_idx" ON "pages" ("created_by");

-- news_articles: status-filtered admin lists ordered by publication_index
CREATE INDEX "news_articles_status_publication_index_idx"
  ON "news_articles" ("status", "publication_index");
CREATE INDEX "news_articles_status_article_type_publication_index_idx"
  ON "news_articles" ("status", "article_type", "publication_index");
CREATE INDEX "news_articles_status_rubric_id_publication_index_idx"
  ON "news_articles" ("status", "rubric_id", "publication_index");
-- note: (status, published_at) and author_id indexes already exist for public/news views
-- note: slug has a UNIQUE constraint that serves as its index
