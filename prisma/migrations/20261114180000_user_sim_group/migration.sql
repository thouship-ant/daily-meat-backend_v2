-- A hash of the SIM numbers of the phone an account last signed in on. A second instance of the app on the same phone
-- (dual apps / cloned app) uses it to find which SIM number is already signed in, and picks the other one.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sim_group" VARCHAR(64);
CREATE INDEX IF NOT EXISTS "users_sim_group_idx" ON "users"("sim_group");
