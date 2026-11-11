-- Supplier bills, website contact messages and scheduled marketing plans can belong to a hub (NULL = not tied to a
-- hub: shown under "All hubs" only). Support tickets and customers are scoped by the orders / addresses of the
-- customer, so they need no column.
ALTER TABLE "seller_bills" ADD COLUMN IF NOT EXISTS "hub_id" INTEGER;
ALTER TABLE "contact_messages" ADD COLUMN IF NOT EXISTS "hub_id" INTEGER;
ALTER TABLE "scheduled_notifications" ADD COLUMN IF NOT EXISTS "hub_id" INTEGER;

CREATE INDEX IF NOT EXISTS "seller_bills_hub_id_idx" ON "seller_bills"("hub_id");
CREATE INDEX IF NOT EXISTS "contact_messages_hub_id_idx" ON "contact_messages"("hub_id");
CREATE INDEX IF NOT EXISTS "scheduled_notifications_hub_id_idx" ON "scheduled_notifications"("hub_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_bills_hub_id_fkey') THEN
    ALTER TABLE "seller_bills" ADD CONSTRAINT "seller_bills_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "shop_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_messages_hub_id_fkey') THEN
    ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "shop_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_notifications_hub_id_fkey') THEN
    ALTER TABLE "scheduled_notifications" ADD CONSTRAINT "scheduled_notifications_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "shop_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
