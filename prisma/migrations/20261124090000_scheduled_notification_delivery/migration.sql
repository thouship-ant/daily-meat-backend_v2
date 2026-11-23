-- How the last scheduled send went: customers in the audience, accepted by Expo, rejected by Expo (with reasons), not
-- sent because the stored token is not a valid Expo token, and customers who could not be reached at all (no device).
ALTER TABLE "scheduled_notifications" ADD COLUMN IF NOT EXISTS "last_customers" INTEGER;
ALTER TABLE "scheduled_notifications" ADD COLUMN IF NOT EXISTS "last_accepted" INTEGER;
ALTER TABLE "scheduled_notifications" ADD COLUMN IF NOT EXISTS "last_rejected" INTEGER;
ALTER TABLE "scheduled_notifications" ADD COLUMN IF NOT EXISTS "last_invalid" INTEGER;
ALTER TABLE "scheduled_notifications" ADD COLUMN IF NOT EXISTS "last_no_device" INTEGER;
ALTER TABLE "scheduled_notifications" ADD COLUMN IF NOT EXISTS "last_errors" JSONB;
