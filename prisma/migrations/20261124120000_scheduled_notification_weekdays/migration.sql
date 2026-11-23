-- Which days of the week a scheduled plan runs on (IST), e.g. 'FRI' or 'SAT,SUN'. Empty = every day, as before.
ALTER TABLE "scheduled_notifications" ADD COLUMN IF NOT EXISTS "weekdays" VARCHAR(30) NOT NULL DEFAULT '';
