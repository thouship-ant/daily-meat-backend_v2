-- One-off: swap the roles (and with them the delivery records) of two staff numbers.
--
--   +919344297939  was the Driver (completed rides, assigned orders, hub, earnings are on this account)
--   +918825997939  was an Admin account
--
-- After:
--   +918825997939  Driver        password Driver@123   <- the driver account with ALL its rides and history
--   +919344297939  Admin + Customer   password DAS@3781   <- the other account (its own history stays with it)
--
-- How: the two user rows exchange phone numbers. Orders, deliveries and addresses reference the user id, so the
-- driver's records move with the account and nothing in `orders` is touched.
-- Their sessions end and their push devices are cleared (the phones are different people/devices now), so the
-- apps sign in again and register for push again.
--
-- Safe to run twice: it only acts while +919344297939 is still the DRIVER and +918825997939 is still an
-- ADMIN/SUPERADMIN; otherwise it prints a notice and changes nothing. Single transaction (all or nothing).
-- Do NOT run prisma/sql/staff-accounts.sql again afterwards: it would set these two numbers back to the old roles.
--
--   $C exec -T db psql -U daily_meat -d daily_meat -v ON_ERROR_STOP=1 --single-transaction < prisma/sql/swap-driver-admin-numbers.sql

DO $$
DECLARE
  drv   uuid;   -- the account that holds the rides (now +919344297939, DRIVER)
  adm   uuid;   -- the account that becomes the Admin + Customer (now +918825997939)
  rides int;
BEGIN
  SELECT id INTO drv FROM "users" WHERE "phone" = '+919344297939' AND "role" = 'DRIVER';
  SELECT id INTO adm FROM "users" WHERE "phone" = '+918825997939' AND "role" IN ('ADMIN', 'SUPERADMIN');

  IF drv IS NULL OR adm IS NULL THEN
    RAISE NOTICE 'Nothing to do: +919344297939 is not a DRIVER and/or +918825997939 is not an ADMIN (already swapped, or accounts missing).';
    RETURN;
  END IF;

  SELECT count(*) INTO rides FROM "orders" WHERE "driver_id" = drv AND "status" = 'DELIVERED';
  RAISE NOTICE 'Driver account % has % delivered orders; it moves to +918825997939.', drv, rides;

  -- free the number first (phone is unique)
  UPDATE "users" SET "phone" = NULL WHERE id = drv;

  -- the admin account takes the old driver number: Admin + Customer, password DAS@3781
  UPDATE "users"
     SET "phone" = '+919344297939',
         "role" = 'ADMIN',
         "additional_roles" = ARRAY['CUSTOMER']::"enum_users_role"[],
         "password" = '$2b$10$GR8w5DMC.F3p0IYDBcuCGeg3dTGUTwwlHFM8KKhxf8/CuGDpMaiBm',      -- DAS@3781
         "is_active" = true,
         "is_profile_completed" = true,
         "tokens_valid_after" = CURRENT_TIMESTAMP,
         "refresh_token" = NULL,
         "push_token" = NULL,
         "push_devices" = NULL,
         "device_id" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP
   WHERE id = adm;

  -- the driver account (with all its records) takes the other number: Driver, password Driver@123
  UPDATE "users"
     SET "phone" = '+918825997939',
         "role" = 'DRIVER',
         "additional_roles" = ARRAY[]::"enum_users_role"[],
         "password" = '$2b$10$NOq0Pd6jNgz4DJlAQHscaeCh.EDWvfGTDfT37GRLFv3iI3TZD3BQi',      -- Driver@123
         "is_active" = true,
         "is_profile_completed" = true,
         "tokens_valid_after" = CURRENT_TIMESTAMP,
         "refresh_token" = NULL,
         "push_token" = NULL,
         "push_devices" = NULL,
         "device_id" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP
   WHERE id = drv;

  RAISE NOTICE 'Done: +918825997939 = DRIVER (% delivered orders), +919344297939 = ADMIN + CUSTOMER.', rides;
END $$;

-- check
SELECT "phone", "role", "additional_roles",
       (SELECT count(*) FROM "orders" o WHERE o."driver_id" = u.id AND o."status" = 'DELIVERED') AS delivered_as_driver
  FROM "users" u
 WHERE "phone" IN ('+918825997939', '+919344297939')
 ORDER BY "phone";
