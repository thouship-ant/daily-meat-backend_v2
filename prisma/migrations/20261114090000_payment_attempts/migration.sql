-- Online payment attempts that did not go through. After an online payment fails the order is no longer cancelled:
-- up to the COD limit it carries on as Cash on Delivery (payment "COD - Pending"), above it the order is FAILED until
-- the customer pays online. The app asks the customer to retry up to 3 times; this counts the failed attempts.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_attempts" INTEGER NOT NULL DEFAULT 0;
