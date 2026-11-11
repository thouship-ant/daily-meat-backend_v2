-- New role: SUPERADMIN (all hubs; creates hubs). It sits in its own migration because a new enum value cannot be
-- used in the same transaction that adds it: the accounts that get the role are set in the next migrations.
ALTER TYPE "enum_users_role" ADD VALUE IF NOT EXISTS 'SUPERADMIN';
