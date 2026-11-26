-- Marinate masalas: a second kind of catalog + delivery slot (ordered 6-10 PM, delivered next day 10:30 AM - 12:30 PM).
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "kind" VARCHAR(12) NOT NULL DEFAULT 'MEAT';
ALTER TABLE "delivery_slots" ADD COLUMN IF NOT EXISTS "kind" VARCHAR(12) NOT NULL DEFAULT 'MEAT';

INSERT INTO "delivery_slots" ("id", "start_time", "end_time", "label", "is_active", "kind", "updatedAt")
SELECT gen_random_uuid(), '10:30 AM', '12:30 PM', 'Marinate masalas: 10:30 AM - 12:30 PM', true, 'MARINATE', now()
WHERE NOT EXISTS (SELECT 1 FROM "delivery_slots" WHERE "kind" = 'MARINATE');

-- The automatic push notifications that used to live only in cron code, as scheduled plans (Marketing Broadcast >
-- scheduled plans): the admin can see, edit, pause or delete them. Wording is generic; the personalised cron variants
-- (reorder reminder with the customer's product and price, "tomorrow's plan" only for customers with no order) are
-- switched off by default (PROMO_REMINDERS_ENABLED / TOMORROW_PLAN_REMINDER_ENABLED = false) so nothing goes out twice.
INSERT INTO "scheduled_notifications" ("name", "title", "body", "audience", "start_date", "end_date", "window_start", "window_end", "weekdays", "is_active", "updatedAt")
SELECT v.name, v.title, v.body, 'ALL', DATE '2026-11-26', DATE '2030-12-31', v.ws, v.we, v.wd, true, now()
FROM (VALUES
  ('Promo - Welcome & first order (Sun/Wed/Fri 7-8 AM)', 'Welcome to Daily Meat 👋', 'Add your address and place an order for yummy chicken 🍗, mutton 🥩 and fish 🐟 - fresh to your door!', '07:00', '08:00', 'SUN,WED,FRI'),
  ('Promo - Fresh stock reorder (Sun/Wed/Fri 7-8 AM)', 'Fresh stock is in today 🍗', 'Order your usual chicken, mutton or fish, delivered fresh. Order now!', '07:00', '08:00', 'SUN,WED,FRI'),
  ('Promo - Fresh pick (Sun/Wed/Fri 10:30-11:30 AM)', 'Fresh pick today 🍗', 'Chicken, mutton and fish - fresh and ready to order. Order now!', '10:30', '11:30', 'SUN,WED,FRI'),
  ('Tomorrow''s plan - 7 PM', 'Plan tomorrow''s meals 🍗', 'Pre-book fresh meat for tomorrow and choose the delivery slot that suits you. Order now!', '19:00', '19:10', ''),
  ('Tomorrow''s plan - 10 PM', 'Plan tomorrow''s order 🥩', 'Pre-book fresh chicken, mutton or fish for tomorrow and pick your delivery slot!', '22:00', '22:10', ''),
  ('Marinate masalas - evening ordering open', 'Marinate masalas 🌶️', 'Order your marinate masalas between 6 PM and 10 PM tonight. Delivery tomorrow 10:30 AM - 12:30 PM.', '18:00', '18:15', '')
) AS v(name, title, body, ws, we, wd)
WHERE NOT EXISTS (SELECT 1 FROM "scheduled_notifications" s WHERE s."name" = v.name);
