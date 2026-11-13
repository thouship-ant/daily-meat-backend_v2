-- Drivers belong to a hub (users.hub_id) and can be lent to another hub for a date range.
-- Written to be re-runnable: safe if some of these objects already exist on the server.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hub_id" INTEGER;

CREATE TABLE IF NOT EXISTS "driver_hub_assignments" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "hub_id" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_hub_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "driver_hub_assignments_driver_idx" ON "driver_hub_assignments"("driver_id", "start_date", "end_date");
CREATE INDEX IF NOT EXISTS "driver_hub_assignments_hub_idx" ON "driver_hub_assignments"("hub_id", "start_date", "end_date");
CREATE INDEX IF NOT EXISTS "users_hub_id_idx" ON "users"("hub_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_hub_id_fkey') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "shop_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_hub_assignments_driver_id_fkey') THEN
    ALTER TABLE "driver_hub_assignments" ADD CONSTRAINT "driver_hub_assignments_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_hub_assignments_hub_id_fkey') THEN
    ALTER TABLE "driver_hub_assignments" ADD CONSTRAINT "driver_hub_assignments_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "shop_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
