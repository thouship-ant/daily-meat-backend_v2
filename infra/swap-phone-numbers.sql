-- Plain swap of the phone numbers of two user accounts. Nothing else changes: roles, passwords, names and every
-- record (orders, driver profile, addresses...) stay on the same account - only the phone number on each account
-- is exchanged. One transaction; stops (changes nothing) if either number is not found.
--
--   docker compose -f docker-compose.prod.yml --env-file .env exec -T db psql -U daily_meat -d daily_meat -v ON_ERROR_STOP=1 < infra/swap-phone-numbers.sql
--
-- To swap other numbers, change the two values on the "\set" lines.

\set num_a '+918825997939'
\set num_b '+919344297939'

BEGIN;

-- Before
SELECT u.id, u.phone, u.name, u.role, u.additional_roles,
       (SELECT count(*) FROM orders o WHERE o.driver_id = u.id) AS rides_as_driver,
       (SELECT count(*) FROM orders o WHERE o.user_id = u.id)   AS orders_as_customer
FROM users u WHERE u.phone IN (:'num_a', :'num_b') ORDER BY u.phone;

SELECT (count(*) = 2) AS both_found FROM users WHERE phone IN (:'num_a', :'num_b') \gset
\if :both_found
\else
  \echo 'STOPPED: both numbers must exist as accounts (the Before table must list 2 rows). Nothing changed.'
  ROLLBACK;
  \quit
\endif

CREATE TEMP TABLE _a AS SELECT id FROM users WHERE phone = :'num_a';
CREATE TEMP TABLE _b AS SELECT id FROM users WHERE phone = :'num_b';

-- the phone column is unique, so go through a temporary value
UPDATE users SET phone = 'swap-' || substr(id::text, 1, 8) WHERE id IN (SELECT id FROM _a UNION SELECT id FROM _b);
UPDATE users SET phone = :'num_b' WHERE id = (SELECT id FROM _a);
UPDATE users SET phone = :'num_a' WHERE id = (SELECT id FROM _b);

-- After
SELECT u.id, u.phone, u.name, u.role, u.additional_roles,
       (SELECT count(*) FROM orders o WHERE o.driver_id = u.id) AS rides_as_driver,
       (SELECT count(*) FROM orders o WHERE o.user_id = u.id)   AS orders_as_customer
FROM users u WHERE u.phone IN (:'num_a', :'num_b') ORDER BY u.phone;

COMMIT;
