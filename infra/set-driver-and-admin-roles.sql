-- STEP 2 of 2 (run after infra/swap-phone-numbers.sql): roles and passwords.
--   +919344297939 -> DRIVER only, password Dvr@7939           (the account that owns the rides)
--   +918825997939 -> SUPERADMIN + ADMIN + CUSTOMER, password DAS@3781
-- Both accounts are signed out everywhere and their push tokens cleared (they sign in again on the phone).
-- Refuses to run unless the rides are on +919344297939 (i.e. STEP 1 is done). One transaction.
--
--   docker compose -f docker-compose.prod.yml --env-file .env exec -T db psql -U daily_meat -d daily_meat -v ON_ERROR_STOP=1 < infra/set-driver-and-admin-roles.sql

BEGIN;

DO $$
DECLARE
  a uuid; b uuid; rides_a int; rides_b int;
BEGIN
  SELECT id INTO a FROM users WHERE phone = '+918825997939';
  SELECT id INTO b FROM users WHERE phone = '+919344297939';
  IF a IS NULL OR b IS NULL THEN RAISE EXCEPTION 'One of the two numbers does not exist - nothing changed'; END IF;
  SELECT count(*) INTO rides_a FROM orders WHERE driver_id = a;
  SELECT count(*) INTO rides_b FROM orders WHERE driver_id = b;
  RAISE NOTICE '+918825997939 has % rides as driver, +919344297939 has % (before)', rides_a, rides_b;
  IF rides_b = 0 OR rides_a > 0 THEN
    RAISE EXCEPTION 'The rides are not on +919344297939 yet (found % / %) - run infra/swap-phone-numbers.sql first. Nothing changed', rides_a, rides_b;
  END IF;
END $$;

UPDATE users SET
  role = 'DRIVER', additional_roles = '{}', is_active = true,
  password = '$2b$10$4OP4Z6kk0lxqFJ/DDhgZ6el0wt1D5XPaefiyvhfbO.hjuZfcJ1lkq',
  refresh_token = NULL, push_token = NULL, push_devices = NULL, tokens_valid_after = now()
WHERE phone = '+919344297939';

UPDATE users SET
  role = 'SUPERADMIN', additional_roles = '{ADMIN,CUSTOMER}', is_active = true,
  password = '$2b$10$Qoft86FKUBkqEJ8Q6lO72.9HF6arSThze.S5ZoNmgWvkSkcFFRg.C',
  refresh_token = NULL, push_token = NULL, push_devices = NULL, tokens_valid_after = now()
WHERE phone = '+918825997939';

-- Check this before it commits
SELECT u.phone, u.name, u.role, u.additional_roles, u.is_active,
       (SELECT count(*) FROM orders o WHERE o.driver_id = u.id) AS rides_as_driver,
       (SELECT count(*) FROM orders o WHERE o.user_id = u.id)   AS orders_as_customer
FROM users u WHERE u.phone IN ('+918825997939', '+919344297939') ORDER BY u.phone;

COMMIT;
