-- A driver who has not set an order limit takes 10 orders per set (was 3).
ALTER TABLE "driver_attendance" ALTER COLUMN "order_limit" SET DEFAULT 10;
-- Rows still on the old default (nobody had changed it) move to the new one.
UPDATE "driver_attendance" SET "order_limit" = 10 WHERE "order_limit" = 3;
