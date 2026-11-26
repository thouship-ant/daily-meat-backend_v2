-- Marinades start as out of stock: the admin switches each one to "In stock" when it is ready to sell.
UPDATE "product_variants" v
SET "in_stock" = false, "updatedAt" = now()
FROM "products" p
JOIN "categories" c ON c."id" = p."category_id"
WHERE v."product_id" = p."id" AND c."kind" = 'MARINADE' AND v."in_stock" = true;
