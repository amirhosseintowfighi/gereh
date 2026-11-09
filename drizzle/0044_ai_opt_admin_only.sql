-- the optimizer is the admin's choice; customers no longer opt in per key
ALTER TABLE "ai_keys" DROP COLUMN IF EXISTS "optimize";
