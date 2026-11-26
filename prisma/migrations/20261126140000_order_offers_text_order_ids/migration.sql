-- Order ids are text (ODDM...), not UUIDs: the offered order ids are stored as text.
ALTER TABLE "order_offers" ALTER COLUMN "order_ids" TYPE TEXT[] USING "order_ids"::text[];
