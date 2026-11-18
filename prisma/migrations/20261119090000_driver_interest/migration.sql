-- People who ask to become a delivery partner while onboarding is on hold (name, mobile, e-mail, hub, locality / city / pincode).
-- One row per mobile number; Daily Meat contacts them by SMS / e-mail when their hub needs drivers.
CREATE TABLE IF NOT EXISTS "driver_interests" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "name"        VARCHAR(100) NOT NULL,
  "phone"       VARCHAR(20) NOT NULL,
  "email"       VARCHAR(150) NOT NULL,
  "hub_id"      INTEGER,
  "locality"    VARCHAR(120) NOT NULL,
  "city"        VARCHAR(80) NOT NULL,
  "pincode"     VARCHAR(6) NOT NULL,
  "notified_at" TIMESTAMPTZ(6),
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "driver_interests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "driver_interests_phone_key" ON "driver_interests"("phone");
CREATE INDEX IF NOT EXISTS "driver_interests_hub_idx" ON "driver_interests"("hub_id");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_interests_hub_id_fkey') THEN
    ALTER TABLE "driver_interests" ADD CONSTRAINT "driver_interests_hub_id_fkey"
      FOREIGN KEY ("hub_id") REFERENCES "shop_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
