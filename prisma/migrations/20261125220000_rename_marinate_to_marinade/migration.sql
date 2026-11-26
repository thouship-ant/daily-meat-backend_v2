-- Spelling: "marinate masala(s)" is now "marinade(s)" everywhere. The two earlier marinate migrations stay as they were
-- applied; this one brings their data to the new wording. Safe to run again.
UPDATE "categories" SET "kind" = 'MARINADE' WHERE "kind" = 'MARINATE';
UPDATE "delivery_slots" SET "kind" = 'MARINADE' WHERE "kind" = 'MARINATE';
UPDATE "delivery_slots" SET "label" = 'Marinades: 10:30 AM - 12:30 PM' WHERE "kind" = 'MARINADE' AND "label" = 'Marinate masalas: 10:30 AM - 12:30 PM';
UPDATE "categories" SET "name" = 'Marinades', "image_url" = NULL WHERE "name" = 'Marinate Masalas' AND NOT EXISTS (SELECT 1 FROM "categories" WHERE "name" = 'Marinades');
-- product names "X Marinate Masala" -> "X Marinade" (the pictures carry the old text and are re-uploaded by `npm run seed:marinade`)
UPDATE "products" p SET "name" = REPLACE(p."name", ' Marinate Masala', ' Marinade'), "image_url" = NULL
WHERE p."name" LIKE '% Marinate Masala' AND p."category_id" IN (SELECT "id" FROM "categories" WHERE "kind" = 'MARINADE');
UPDATE "products" SET "image_url" = NULL WHERE "name" IN ('Mutton Pepper Fry Masala', 'Prawn Masala', 'Biryani Masala')
  AND "category_id" IN (SELECT "id" FROM "categories" WHERE "kind" = 'MARINADE');
UPDATE "scheduled_notifications" SET
  "name" = REPLACE(REPLACE("name", 'Marinate masalas', 'Marinades'), 'marinate masalas', 'marinades'),
  "title" = REPLACE(REPLACE("title", 'Marinate masalas', 'Marinades'), 'marinate masalas', 'marinades'),
  "body" = REPLACE(REPLACE("body", 'Marinate masalas', 'Marinades'), 'marinate masalas', 'marinades')
WHERE "name" ILIKE '%marinate%' OR "title" ILIKE '%marinate%' OR "body" ILIKE '%marinate%';
