-- Driver onboarding: KYC (last 4 Aadhaar digits + photos), hub, selfie, vehicle, starting deposit, admin approval.
-- A driver WITHOUT a row here is a driver from before onboarding existed and counts as approved, so nobody who is
-- already working is blocked by this migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_driver_profiles_status') THEN
    CREATE TYPE "enum_driver_profiles_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "driver_profiles" (
  "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"            UUID NOT NULL,
  "status"             "enum_driver_profiles_status" NOT NULL DEFAULT 'DRAFT',
  "aadhaar_last4"      VARCHAR(4),
  "aadhaar_name"       VARCHAR(100),
  "aadhaar_front_key"  TEXT,
  "aadhaar_back_key"   TEXT,
  "kyc_method"         VARCHAR(20),
  "kyc_verified_at"    TIMESTAMPTZ(6),
  "hub_id"             INTEGER,
  "selfie_key"         TEXT,
  "vehicle_model"      VARCHAR(80),
  "vehicle_reg_no"     VARCHAR(20),
  "vehicle_year"       INTEGER,
  "deposit_amount"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "deposit_paid"       BOOLEAN NOT NULL DEFAULT false,
  "deposit_gateway_id" TEXT,
  "deposit_cf_order_id" TEXT,
  "deposit_session_id" TEXT,
  "deposit_paid_at"    TIMESTAMPTZ(6),
  "submitted_at"       TIMESTAMPTZ(6),
  "reviewed_at"        TIMESTAMPTZ(6),
  "reviewed_by_id"     UUID,
  "reject_reason"      TEXT,
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "driver_profiles_user_id_key" ON "driver_profiles"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "driver_profiles_deposit_gateway_id_key" ON "driver_profiles"("deposit_gateway_id");
CREATE INDEX IF NOT EXISTS "driver_profiles_status_idx" ON "driver_profiles"("status");
CREATE INDEX IF NOT EXISTS "driver_profiles_hub_idx" ON "driver_profiles"("hub_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_profiles_user_id_fkey') THEN
    ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_profiles_hub_id_fkey') THEN
    ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_hub_id_fkey"
      FOREIGN KEY ("hub_id") REFERENCES "shop_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
