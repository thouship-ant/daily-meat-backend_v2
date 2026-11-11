-- Super admins: the three team numbers become SUPERADMIN, keeping Admin (and Customer / Driver) as extra roles so
-- the login screen still offers them after the password and the OTP. Their password stays DAS@3781.
--   +919363803781  SUPERADMIN + Admin, Customer, Driver
--   +919600249294  SUPERADMIN + Admin, Customer
--   +918825997939  SUPERADMIN + Admin
-- Only numbers that already exist as users are changed (a migration never creates users, see 20261111120000);
-- prisma/sql/staff-accounts.sql creates any that are missing.

WITH wanted(phone, role, extra) AS (
  VALUES
    ('+919363803781', 'SUPERADMIN', ARRAY['ADMIN','CUSTOMER','DRIVER']::"enum_users_role"[]),
    ('+919600249294', 'SUPERADMIN', ARRAY['ADMIN','CUSTOMER']::"enum_users_role"[]),
    ('+918825997939', 'SUPERADMIN', ARRAY['ADMIN']::"enum_users_role"[])
)
UPDATE "users" u
   SET "role" = w.role::"enum_users_role",
       "additional_roles" = w.extra,
       "tokens_valid_after" = CURRENT_TIMESTAMP,   -- ends old sessions so the new role applies
       "refresh_token" = NULL,
       "updatedAt" = CURRENT_TIMESTAMP
  FROM wanted w
 WHERE u."phone" = w.phone;
