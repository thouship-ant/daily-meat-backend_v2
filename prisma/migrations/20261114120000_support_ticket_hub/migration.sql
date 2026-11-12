-- A support ticket can belong to a hub. The system raises one when a customer deletes their account (with the reason),
-- addressed to the hub the customer ordered from; the hub's admins see it in their Support Tickets list.
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "hub_id" INTEGER;
CREATE INDEX IF NOT EXISTS "support_tickets_hub_idx" ON "support_tickets"("hub_id");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_hub_id_fkey') THEN
    ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_hub_id_fkey"
      FOREIGN KEY ("hub_id") REFERENCES "shop_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
