-- One-off: remove the delivery-partner APPLICATION (KYC onboarding profile) of +919791712141 together with the
-- "New driver application" notifications the hub admins got for it (the bell badge).
--
--   driver_profiles     the application (one row per user: status, KYC photo keys, vehicle, deposit)
--   user_notifications  inbox rows with data.type = 'DRIVER_APPLICATION' and data.userId = this person
--
-- NOT touched: the user account itself, the KYC photos in the private storage bucket (their keys are printed in step 1,
-- delete them separately if you want them gone) and any deposit payment (if deposit_paid is true, refund it in the
-- payment gateway; deleting this row does not reverse it).
-- The earlier "Interested" request of the same number is a different table (driver_interests); see
-- remove-driver-interest-munsaha.sql.
--
-- Safe: one transaction, matches only this phone's profile and this user's notices, prints what it removed.
-- Read the step 1 output; if it is not what you expect, run ROLLBACK instead of COMMIT.
--
--   $C exec -T db psql -U daily_meat -d daily_meat -v ON_ERROR_STOP=1 -f - < prisma/sql/remove-driver-application-9791712141.sql
--   (take a backup first: pg_dump -Fc ... > before-remove-application.dump)

BEGIN;

-- 1. what will be removed
SELECT u.id AS user_id, u.name, u.phone, u.role, u."createdAt" AS user_created
  FROM "users" u WHERE u."phone" = '+919791712141';

SELECT p.id, p."user_id", p.status, p."kyc_method", p."deposit_paid", p."deposit_amount", p."deposit_gateway_id",
       p."aadhaar_front_key", p."aadhaar_back_key", p."selfie_key", p."submitted_at", p."created_at"
  FROM "driver_profiles" p JOIN "users" u ON u.id = p."user_id"
 WHERE u."phone" = '+919791712141';

SELECT n.id, n."user_id" AS sent_to, n.title, n.body, n."read_at", n."created_at"
  FROM "user_notifications" n
 WHERE n."data"->>'type' = 'DRIVER_APPLICATION'
   AND n."data"->>'userId' IN (SELECT id::text FROM "users" WHERE "phone" = '+919791712141');

-- 2. remove them
DELETE FROM "user_notifications" n
 WHERE n."data"->>'type' = 'DRIVER_APPLICATION'
   AND n."data"->>'userId' IN (SELECT id::text FROM "users" WHERE "phone" = '+919791712141');

DELETE FROM "driver_profiles"
 WHERE "user_id" IN (SELECT id FROM "users" WHERE "phone" = '+919791712141');

-- 3. only COMMIT if step 1 showed exactly one profile and its notice(s) for the hub admins
COMMIT;
