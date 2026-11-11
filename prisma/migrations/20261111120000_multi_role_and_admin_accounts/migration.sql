-- Multi-role accounts: users.additional_roles lets one phone sign in as more than one role. The login screen
-- asks for the password and the OTP first and then which role to sign in as (see AuthService.multiRole*).
-- The data export (daily-meat-backend/db-export/data.sql) has exactly the same columns as the v2 schema, so there is
-- no other structural change to apply.
--
-- Safe on a fresh database and on a populated one, and safe to run before `data.sql` is imported: it never creates
-- users (the import needs empty tables). Creating the staff accounts on a database that does not have them yet is
-- the separate, explicit step prisma/sql/staff-accounts.sql (see DEPLOY.md).

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "additional_roles" "enum_users_role"[] DEFAULT ARRAY[]::"enum_users_role"[];

-- The old admin number is replaced by 9363803781. That number already belongs to a customer (with orders and an
-- address), so that account is promoted in place and keeps its history. The previous admin row (+919876543210) has
-- no orders or addresses; it only gives up the phone number (it keeps its e-mail login).
UPDATE "users" SET "phone" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE "phone" = '+919876543210';

-- Staff accounts that already exist as users are promoted. Password for every account below: DAS@3781 (bcrypt).
-- (phone, role, additional roles)
WITH wanted(phone, role, extra) AS (
  VALUES
    ('+919363803781', 'ADMIN',  ARRAY['CUSTOMER','DRIVER']::"enum_users_role"[]),
    ('+919600249294', 'ADMIN',  ARRAY['CUSTOMER']::"enum_users_role"[]),
    ('+918825997939', 'ADMIN',  ARRAY[]::"enum_users_role"[]),
    ('+919344297939', 'DRIVER', ARRAY[]::"enum_users_role"[])
)
UPDATE "users" u
   SET "role" = w.role::"enum_users_role",
       "additional_roles" = w.extra,
       "password" = '$2b$10$GR8w5DMC.F3p0IYDBcuCGeg3dTGUTwwlHFM8KKhxf8/CuGDpMaiBm',
       "is_active" = true,
       "is_profile_completed" = true,
       "tokens_valid_after" = CURRENT_TIMESTAMP,   -- ends old sessions so the new role/password apply
       "refresh_token" = NULL,
       "updatedAt" = CURRENT_TIMESTAMP
  FROM wanted w
 WHERE u."phone" = w.phone;
