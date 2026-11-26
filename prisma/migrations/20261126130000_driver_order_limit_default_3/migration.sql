-- A driver who has not set an order limit takes 3 orders per set (was 10).
ALTER TABLE "driver_attendance" ALTER COLUMN "order_limit" SET DEFAULT 3;
UPDATE "driver_attendance" SET "order_limit" = 3 WHERE "order_limit" = 10;
