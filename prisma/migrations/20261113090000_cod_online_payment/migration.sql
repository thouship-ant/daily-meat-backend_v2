-- Paying a Cash on Delivery order online (until it is out for delivery + 5 minutes)
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "gateway_order_id" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "out_for_delivery_at" TIMESTAMPTZ(6);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pay_closed_notified_at" TIMESTAMPTZ(6);

-- orders already out for delivery: count from their last update
UPDATE "orders" SET "out_for_delivery_at" = "updatedAt" WHERE "status" = 'OUT_FOR_DELIVERY' AND "out_for_delivery_at" IS NULL;
