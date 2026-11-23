-- One-off: remove the delivery-partner interest request from +919791712141 (Munsaha, Kumbakonam) together with the
-- notification(s) the admins got for it (the bell badge).
--
--   driver_interests    the request itself (one row per phone number)
--   user_notifications  the inbox rows sent to the hub admins when it was submitted
--                       (kind 'driverApplication', data.type = 'DRIVER_INTEREST', body starts with the person's name)
--
-- Safe: one transaction, deletes only rows that match this phone / this person's notice, and prints what it removed.
-- Look at the two SELECT results first; if they are not what you expect, run ROLLBACK instead of COMMIT.
--
--   $C exec -T db psql -U daily_meat -d daily_meat -v ON_ERROR_STOP=1 -f - < prisma/sql/remove-driver-interest-munsaha.sql
--   (take a backup first: pg_dump -Fc ... > before-remove-interest.dump)

BEGIN;

-- 1. what will be removed
SELECT id, name, phone, email, locality, city, pincode, "created_at"
  FROM "driver_interests" WHERE "phone" = '+919791712141';

SELECT id, "user_id", title, body, kind, "read_at", "created_at"
  FROM "user_notifications"
 WHERE "data"->>'type' = 'DRIVER_INTEREST'
   AND "body" LIKE 'Munsaha (%';

-- 2. remove them
DELETE FROM "user_notifications"
 WHERE "data"->>'type' = 'DRIVER_INTEREST'
   AND "body" LIKE 'Munsaha (%';

DELETE FROM "driver_interests" WHERE "phone" = '+919791712141';

-- 3. only COMMIT if step 1 showed exactly the expected rows (1 request, and its notification(s) for the hub admins)
COMMIT;
