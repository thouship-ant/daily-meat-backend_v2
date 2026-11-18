-- "Unread" tracking for the admin: a delivery-partner interest request / a submitted application counts as unread until an admin opens it.
ALTER TABLE "driver_interests" ADD COLUMN IF NOT EXISTS "seen_at" TIMESTAMPTZ(6);
ALTER TABLE "driver_profiles" ADD COLUMN IF NOT EXISTS "admin_seen_at" TIMESTAMPTZ(6);
-- what is already in the lists before this change was seen by definition: do not light up old rows as unread
UPDATE "driver_interests" SET "seen_at" = CURRENT_TIMESTAMP WHERE "seen_at" IS NULL;
UPDATE "driver_profiles" SET "admin_seen_at" = CURRENT_TIMESTAMP WHERE "admin_seen_at" IS NULL;
