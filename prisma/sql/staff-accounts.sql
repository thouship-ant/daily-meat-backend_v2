-- Staff accounts for the current team (run by hand, see DEPLOY.md). Idempotent: promotes the numbers that already
-- exist as users and creates the ones that do not. Run it AFTER `data.sql` was imported (the import needs empty tables).
-- It sets the password of every account below to DAS@3781 and ends their sessions; run it again only when you want that.
--
--   $C exec -T db psql -U daily_meat -d daily_meat -v ON_ERROR_STOP=1 --single-transaction < prisma/sql/staff-accounts.sql
--
--   +919363803781  Super admin  (also Admin, Customer, Driver)   replaces the old admin number +919876543210
--   +919600249294  Super admin  (also Admin, Customer)
--   +918825997939  Super admin  (also Admin)
--   +919344297939  Driver

-- The old admin number gives up its phone (that row keeps its e-mail login); 9363803781 takes over as an admin.
UPDATE "users" SET "phone" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE "phone" = '+919876543210';

WITH wanted(phone, name, role, extra) AS (
  VALUES
    ('+919363803781', 'Admin',  'SUPERADMIN', ARRAY['ADMIN','CUSTOMER','DRIVER']::"enum_users_role"[]),
    ('+919600249294', 'Admin',  'SUPERADMIN', ARRAY['ADMIN','CUSTOMER']::"enum_users_role"[]),
    ('+918825997939', 'Admin',  'SUPERADMIN', ARRAY['ADMIN']::"enum_users_role"[]),
    ('+919344297939', 'Driver', 'DRIVER',     ARRAY[]::"enum_users_role"[])
)
UPDATE "users" u
   SET "role" = w.role::"enum_users_role",
       "additional_roles" = w.extra,
       "password" = '$2b$10$GR8w5DMC.F3p0IYDBcuCGeg3dTGUTwwlHFM8KKhxf8/CuGDpMaiBm',
       "is_active" = true,
       "is_profile_completed" = true,
       "tokens_valid_after" = CURRENT_TIMESTAMP,
       "refresh_token" = NULL,
       "updatedAt" = CURRENT_TIMESTAMP
  FROM wanted w
 WHERE u."phone" = w.phone;

INSERT INTO "users" ("id", "name", "phone", "password", "role", "additional_roles", "is_profile_completed", "updatedAt")
SELECT gen_random_uuid(), w.name, w.phone, '$2b$10$GR8w5DMC.F3p0IYDBcuCGeg3dTGUTwwlHFM8KKhxf8/CuGDpMaiBm', w.role::"enum_users_role", w.extra, true, CURRENT_TIMESTAMP
  FROM (VALUES
    ('+919363803781', 'Admin',  'SUPERADMIN', ARRAY['ADMIN','CUSTOMER','DRIVER']::"enum_users_role"[]),
    ('+919600249294', 'Admin',  'SUPERADMIN', ARRAY['ADMIN','CUSTOMER']::"enum_users_role"[]),
    ('+918825997939', 'Admin',  'SUPERADMIN', ARRAY['ADMIN']::"enum_users_role"[]),
    ('+919344297939', 'Driver', 'DRIVER',     ARRAY[]::"enum_users_role"[])
  ) AS w(phone, name, role, extra)
 WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."phone" = w.phone);
