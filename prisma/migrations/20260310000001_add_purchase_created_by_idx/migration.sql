-- Add index on purchases.created_by_id to support efficiently listing
-- purchases by their creator (a SALES_MANAGER's primary view of their own data).
-- Without this index the query requires a full table scan as the table grows.

CREATE INDEX "purchases_created_by_id_idx" ON "purchases"("created_by_id");
