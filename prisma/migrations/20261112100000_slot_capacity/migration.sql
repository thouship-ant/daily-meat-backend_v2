-- How many orders one hub accepts for a delivery slot on one day. NULL = no limit (the behaviour so far).
ALTER TABLE "delivery_slots" ADD COLUMN IF NOT EXISTS "max_orders" INTEGER;
