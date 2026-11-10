-- Address review, approved addresses and user activity tracking (ported from the v1 migrations
-- 20261110000000..20261110000300). IF NOT EXISTS: a database that already ran the v1 migrations keeps working.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signup_latitude" DOUBLE PRECISION;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signup_longitude" DOUBLE PRECISION;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMPTZ(6);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_active_at" TIMESTAMPTZ(6);

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "address_change_requested_at" TIMESTAMPTZ(6);

CREATE TABLE IF NOT EXISTS "approved_addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "address_key" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "approved_by" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "approved_addresses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "approved_addresses_address_key_key" ON "approved_addresses"("address_key");
