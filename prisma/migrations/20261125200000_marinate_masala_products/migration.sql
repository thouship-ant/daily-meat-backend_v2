-- Marinate masala catalog: the "Marinate Masalas" category and the six classic Indian chicken marinades (Tandoori, Butter
-- Chicken, Chicken Tikka, Malai Kebab, Hariyali, Chettinad) with 100 g / 250 g packs. Safe to run again: rows are matched by
-- name, nothing existing is changed. Pictures are not part of a migration: `npm run seed:marinate` uploads them
-- (prisma/seed-assets/marinate) to the image storage and fills in the missing image_url of these rows.
INSERT INTO "categories" ("id", "name", "is_active", "sort_order", "kind", "updatedAt")
SELECT gen_random_uuid(), 'Marinate Masalas', true, COALESCE((SELECT MAX("sort_order") FROM "categories"), 0) + 1, 'MARINATE', now()
WHERE NOT EXISTS (SELECT 1 FROM "categories" WHERE "name" = 'Marinate Masalas');

INSERT INTO "products" ("id", "category_id", "name", "description", "sort_order", "updatedAt")
SELECT gen_random_uuid(), c."id", v.name, v.descr, v.ord, now()
FROM "categories" c,
  (VALUES
    ('Tandoori Chicken Marinate Masala', 'Smoky tandoori spice mix. Mix with thick curd, ginger-garlic paste and lemon juice; marinate 500 g chicken for 4 hours.', 2),
    ('Butter Chicken Marinate Masala', 'Rich, mildly spiced mix for butter chicken. Marinate chicken thighs with curd, ginger-garlic paste and the masala, then grill and simmer in the gravy.', 3),
    ('Chicken Tikka Marinate Masala', 'Tangy, mildly spicy tikka mix. Just add thick curd and lemon, marinate boneless chicken cubes and grill.', 4),
    ('Malai Kebab Marinate Masala', 'Creamy white-pepper and cardamom mix for soft malai kebabs. Blend with cream, curd and cornflour for a melt-in-the-mouth bite.', 5),
    ('Hariyali Chicken Marinate Masala', 'Fresh green mix with coriander and mint flavour for hariyali chicken tikka. Marinate with curd and cook on the grill or tawa.', 6),
    ('Chettinad Chicken Marinate Masala', 'Bold South Indian Chettinad mix with pepper, fennel and curry leaf. Marinate chicken for 1 hour and cook with shallots and coconut.', 7)
  ) AS v(name, descr, ord)
WHERE c."name" = 'Marinate Masalas'
  AND NOT EXISTS (SELECT 1 FROM "products" p WHERE p."category_id" = c."id" AND p."name" = v.name);

INSERT INTO "product_variants" ("id", "product_id", "weight", "price", "cost_price", "updatedAt")
SELECT gen_random_uuid(), p."id", v.weight, v.price, ROUND(v.price * 0.6), now()
FROM "products" p
JOIN (VALUES
    ('Tandoori Chicken Marinate Masala', '100g', 60), ('Tandoori Chicken Marinate Masala', '250g', 130),
    ('Butter Chicken Marinate Masala', '100g', 65), ('Butter Chicken Marinate Masala', '250g', 140),
    ('Chicken Tikka Marinate Masala', '100g', 60), ('Chicken Tikka Marinate Masala', '250g', 130),
    ('Malai Kebab Marinate Masala', '100g', 65), ('Malai Kebab Marinate Masala', '250g', 140),
    ('Hariyali Chicken Marinate Masala', '100g', 60), ('Hariyali Chicken Marinate Masala', '250g', 130),
    ('Chettinad Chicken Marinate Masala', '100g', 65), ('Chettinad Chicken Marinate Masala', '250g', 140)
  ) AS v(name, weight, price) ON p."name" = v.name
JOIN "categories" c ON c."id" = p."category_id" AND c."name" = 'Marinate Masalas'
WHERE NOT EXISTS (SELECT 1 FROM "product_variants" x WHERE x."product_id" = p."id" AND x."weight" = v.weight);
