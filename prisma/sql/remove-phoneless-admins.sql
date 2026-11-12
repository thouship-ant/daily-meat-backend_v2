-- One-off clean-up: remove the Admin / Super Admin accounts that have no mobile number, and the dummy admin
-- +910000000001 (placeholder logins created for local testing).
--
--   $C exec -T db psql -U daily_meat -d daily_meat -v ON_ERROR_STOP=1 --single-transaction < prisma/sql/remove-phoneless-admins.sql
--
-- Safety:
--  * Only role ADMIN / SUPERADMIN accounts whose phone is empty or +910000000001 are touched.
--  * An account that has order history (as a customer or as a driver) or coupon use is NOT deleted: it is
--    deactivated and its sign-in is cleared instead (listed in the notice), so no history is lost.
--  * It refuses to run (nothing changes) unless at least one active Super Admin with a real mobile number
--    would remain, so you can never lock yourself out.
--  * Addresses, tickets and hub assignments of a deleted account go with it (ON DELETE CASCADE).
--  * Safe to run twice: the second run finds nothing to do.

-- what will be removed (review this list in the output)
SELECT u."id", u."name", u."email", u."phone", u."role",
       (SELECT count(*) FROM "orders" o WHERE o."user_id" = u."id") AS orders_as_customer,
       (SELECT count(*) FROM "orders" o WHERE o."driver_id" = u."id") AS orders_as_driver
  FROM "users" u
 WHERE u."role" IN ('ADMIN', 'SUPERADMIN')
   AND (u."phone" IS NULL OR btrim(u."phone") = '' OR u."phone" = '+910000000001')
 ORDER BY u."role", u."createdAt";

DO $$
DECLARE
  keepers int;
  removed int;
  kept    int;
BEGIN
  -- a real, active super admin must remain
  SELECT count(*) INTO keepers FROM "users"
   WHERE "role" = 'SUPERADMIN' AND "is_active" AND "phone" IS NOT NULL AND btrim("phone") <> '' AND "phone" <> '+910000000001';
  IF keepers = 0 THEN
    RAISE EXCEPTION 'Stopped: no active Super Admin with a mobile number would remain. Nothing was changed.';
  END IF;

  -- delete the ones without any history
  WITH target AS (
    SELECT u."id" FROM "users" u
     WHERE u."role" IN ('ADMIN', 'SUPERADMIN')
       AND (u."phone" IS NULL OR btrim(u."phone") = '' OR u."phone" = '+910000000001')
       AND NOT EXISTS (SELECT 1 FROM "orders" o WHERE o."user_id" = u."id" OR o."driver_id" = u."id")
       AND NOT EXISTS (SELECT 1 FROM "coupon_redemptions" c WHERE c."user_id" = u."id")
  ), del AS (
    DELETE FROM "users" WHERE "id" IN (SELECT "id" FROM target) RETURNING 1
  )
  SELECT count(*) INTO removed FROM del;

  -- the rest have history: keep the row, but they can no longer sign in
  UPDATE "users"
     SET "is_active" = false, "password" = NULL, "phone" = NULL, "refresh_token" = NULL,
         "push_token" = NULL, "tokens_valid_after" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
   WHERE "role" IN ('ADMIN', 'SUPERADMIN')
     AND ("phone" IS NULL OR btrim("phone") = '' OR "phone" = '+910000000001')
     AND ("is_active" OR "password" IS NOT NULL OR "phone" IS NOT NULL);
  GET DIAGNOSTICS kept = ROW_COUNT;

  RAISE NOTICE 'Deleted % account(s); deactivated % that have order history.', removed, kept;
END $$;

-- check: every remaining admin / super admin
SELECT "phone", "name", "role", "is_active" FROM "users" WHERE "role" IN ('ADMIN', 'SUPERADMIN') ORDER BY "role", "phone";
