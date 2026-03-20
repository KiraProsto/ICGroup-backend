-- AlterTable: constrain actorIp to VARCHAR(45) and actorUserAgent to VARCHAR(512)
-- Truncates any existing values that exceed the new limits before altering.

UPDATE "audit_logs" SET "actor_ip" = LEFT("actor_ip", 45) WHERE LENGTH("actor_ip") > 45;
UPDATE "audit_logs" SET "actor_user_agent" = LEFT("actor_user_agent", 512) WHERE LENGTH("actor_user_agent") > 512;

ALTER TABLE "audit_logs" ALTER COLUMN "actor_ip" SET DATA TYPE VARCHAR(45);
ALTER TABLE "audit_logs" ALTER COLUMN "actor_user_agent" SET DATA TYPE VARCHAR(512);
