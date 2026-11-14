-- STEP 1 of 2: swap ONLY the phone numbers of the two accounts. Roles, passwords and names are not touched.
--   +918825997939 (driver, 187 rides)  ->  +919344297939
--   +919344297939 (other account)      ->  +918825997939
-- Rides (orders.driver_id), the driver profile, hub records etc. belong to the account (row), so they move with the
-- driver to the new number. One transaction: a failed check rolls everything back.
--
--   docker compose -f docker-compose.prod.yml --env-file .env exec -T db psql -U daily_meat -d daily_meat -v ON_ERROR_STOP=1 < infra/swap-phone-numbers.sql
--
-- Then run STEP 2: infra/set-driver-and-admin-roles.sql

BEGIN;

DO $$
DECLARE
  a uuid; b uuid; rides_a int; rides_b int;
BEGIN
  SELECT id INTO a FROM users WHERE phone = '+918825997939';
  SELECT id INTO b FROM users WHERE phone = '+919344297939';
  IF a IS NULL THEN RAISE EXCEPTION 'No user with phone +918825997939 - nothing changed'; END IF;
  IF b IS NULL THEN RAISE EXCEPTION 'No user with phone +919344297939 - nothing changed'; END IF;
  SELECT count(*) INTO rides_a FROM orders WHERE driver_id = a;
  SELECT count(*) INTO rides_b FROM orders WHERE driver_id = b;
  RAISE NOTICE '+918825997939 has % rides as driver, +919344297939 has % (before)', rides_a, rides_b;
  IF rides_a = 0 OR rides_b > 0 THEN
    RAISE EXCEPTION 'Expected the rides on +918825997939 and none on +919344297939 (found % / %) - nothing changed', rides_a, rides_b;
  END IF;
END $$;

CREATE TEMP TABLE _driver AS SELECT id FROM users WHERE phone = '+918825997939';  -- owns the rides
CREATE TEMP TABLE _other  AS SELECT id FROM users WHERE phone = '+919344297939';

-- the phone column is unique, so go through a temporary value
UPDATE users SET phone = 'swap-' || substr(id::text, 1, 8) WHERE id IN (SELECT id FROM _driver UNION SELECT id FROM _other);
UPDATE users SET phone = '+919344297939' WHERE id = (SELECT id FROM _driver);
UPDATE users SET phone = '+918825997939' WHERE id = (SELECT id FROM _other);

-- Check this before it commits: the rides must now be on +919344297939
SELECT u.phone, u.name, u.role, u.additional_roles, u.is_active,
       (SELECT count(*) FROM orders o WHERE o.driver_id = u.id) AS rides_as_driver,
       (SELECT count(*) FROM orders o WHERE o.user_id = u.id)   AS orders_as_customer
FROM users u WHERE u.phone IN ('+918825997939', '+919344297939') ORDER BY u.phone;

COMMIT;
