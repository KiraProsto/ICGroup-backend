-- The unique indexes on users.email and news_articles.slug already serve every
-- lookup purpose a plain B-tree index would. The duplicate indexes add write
-- overhead on INSERT/UPDATE/DELETE without any query benefit.

-- DropIndex
DROP INDEX "users_email_idx";

-- DropIndex
DROP INDEX "news_articles_slug_idx";
