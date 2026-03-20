-- Migration: pages_dynamic_slug_name
-- Replaces the fixed PageType enum with a free-form slug + human-readable name,
-- enabling admins to create new pages dynamically from the admin panel.

-- DropIndex (old unique constraint on pages.type) — IF EXISTS handles partial execution.
DROP INDEX IF EXISTS "pages_type_key";

-- Step 1: Add new columns as NULLABLE so the statement succeeds on non-empty tables.
ALTER TABLE "pages"
  ADD COLUMN "name" TEXT,
  ADD COLUMN "slug" TEXT;

-- Step 2: Back-fill from the existing PageType enum value.
-- HOME  → slug='home',  name='Home'
-- ABOUT → slug='about', name='About'
-- Any future values follow the same LOWER / INITCAP convention.
UPDATE "pages"
  SET "slug" = LOWER("type"::text),
      "name" = INITCAP(REPLACE("type"::text, '_', ' '))
WHERE "type" IS NOT NULL;

-- Step 3: Drop the old enum column, then enforce NOT NULL on the new ones.
ALTER TABLE "pages" DROP COLUMN "type";
ALTER TABLE "pages"
  ALTER COLUMN "name" SET NOT NULL,
  ALTER COLUMN "slug" SET NOT NULL;

-- DropEnum (must happen after the last reference to PageType is removed)
DROP TYPE IF EXISTS "PageType";

-- CreateIndex: unique index on slug (replaces pages_type_key)
CREATE UNIQUE INDEX "pages_slug_key" ON "pages"("slug");
