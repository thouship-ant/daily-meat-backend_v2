-- Driver attendance (one row per driver) and the offers of confirmed orders to present drivers.
CREATE TABLE "driver_attendance" (
  "driver_id"       UUID PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "present"         BOOLEAN NOT NULL DEFAULT false,
  "attendance_date" DATE,
  "present_at"      TIMESTAMPTZ,
  "order_limit"     INTEGER NOT NULL DEFAULT 10,
  "updated_by"      UUID,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "order_offers" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "driver_id"     UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "delivery_date" DATE NOT NULL,
  "set_number"    INTEGER NOT NULL,
  "order_ids"     UUID[] NOT NULL,
  "status"        VARCHAR(12) NOT NULL DEFAULT 'OFFERED',
  "expires_at"    TIMESTAMPTZ NOT NULL,
  "responded_at"  TIMESTAMPTZ,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "order_offers_set_status_idx" ON "order_offers" ("delivery_date", "set_number", "status");
CREATE INDEX "order_offers_driver_status_idx" ON "order_offers" ("driver_id", "status");
