/**
 * Creates the "Marinades" category with starter products and variants (safe to run again: existing names are
 * kept) and uploads the illustrations in prisma/seed-assets/marinade to the image storage (S3_BUCKET etc. from .env).
 *   npm run seed:marinade
 * Without S3_BUCKET the records are created without pictures; add them later in Admin > More > Marinades.
 */
import '../src/env-local';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DIR = join(__dirname, 'seed-assets', 'marinade');
const PRODUCTS: { name: string; file: string; description: string; variants: [string, number][] }[] = [
  { name: 'Butter Chicken Marinade', file: 'butter-chicken', description: 'Rich, mildly spiced mix for butter chicken.', variants: [['100g', 65], ['250g', 140]] },
  { name: 'Malai Kebab Marinade', file: 'malai-kebab', description: 'Creamy white-pepper and cardamom mix for soft malai kebabs.', variants: [['100g', 65], ['250g', 140]] },
  { name: 'Hariyali Chicken Marinade', file: 'hariyali-chicken', description: 'Fresh green mix for hariyali chicken tikka.', variants: [['100g', 60], ['250g', 130]] },
  { name: 'Chettinad Chicken Marinade', file: 'chettinad-chicken', description: 'Bold South Indian Chettinad mix with pepper, fennel and curry leaf.', variants: [['100g', 65], ['250g', 140]] },
  { name: 'Chicken 65 Marinade', file: 'chicken-65', description: 'Spicy South Indian chicken 65 mix. Marinate 500 g chicken for 30 minutes, then fry.', variants: [['100g', 55], ['250g', 120]] },
  { name: 'Tandoori Chicken Marinade', file: 'tandoori-chicken', description: 'Smoky tandoori spice mix for oven, tawa or grill.', variants: [['100g', 60], ['250g', 130]] },
  { name: 'Chicken Tikka Marinade', file: 'chicken-tikka', description: 'Tangy, mildly spicy tikka mix. Just add curd and lemon.', variants: [['100g', 60], ['250g', 130]] },
  { name: 'Chilli Chicken Marinade', file: 'chilli-chicken', description: 'Indo-Chinese chilli chicken starter mix.', variants: [['100g', 55], ['250g', 120]] },
  { name: 'Mutton Pepper Fry Masala', file: 'mutton-pepper-fry', description: 'Black pepper and curry leaf mix for dry mutton fry.', variants: [['100g', 70], ['250g', 150]] },
  { name: 'Fish Fry Marinade', file: 'fish-fry', description: 'Crisp coastal-style fish fry masala.', variants: [['100g', 55], ['250g', 120]] },
  { name: 'Prawn Masala', file: 'prawn-masala', description: 'Quick prawn fry / thokku masala mix.', variants: [['100g', 65], ['250g', 140]] },
  { name: 'Biryani Masala', file: 'biryani-masala', description: 'Whole-spice biryani blend for chicken or mutton biryani.', variants: [['100g', 60], ['250g', 130]] },
];

async function main() {
  const prisma = new PrismaClient();
  const bucket = process.env.S3_BUCKET;
  const s3 = bucket
    ? new S3Client({
        region: process.env.AWS_REGION || 'auto',
        ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT, forcePathStyle: true } : {}),
        credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '' },
      })
    : null;
  const upload = async (file: string, folder: string): Promise<string | null> => {
    if (!s3 || !bucket) return null;
    const key = `${folder}/${randomUUID()}.png`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: readFileSync(join(DIR, `${file}.png`)), ContentType: 'image/png' }));
    const base = process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, '');
    return base ? `${base}/${key}` : `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  };
  try {
    let category = await prisma.category.findUnique({ where: { name: 'Marinades' } });
    if (!category) {
      const max = await prisma.category.aggregate({ _max: { sortOrder: true } });
      category = await prisma.category.create({
        data: { name: 'Marinades', kind: 'MARINADE', imageUrl: await upload('category-marinades', 'categories'), sortOrder: (max._max.sortOrder ?? 0) + 1 },
      });
      console.log('Created category Marinades');
    } else if (category.kind !== 'MARINADE') {
      throw new Error('A category named "Marinades" already exists with another kind.');
    } else if (!category.imageUrl) {
      // created by the migration (no picture yet)
      category = await prisma.category.update({ where: { id: category.id }, data: { imageUrl: await upload('category-marinades', 'categories') } });
      console.log('Added the category picture');
    }
    let order = 0;
    for (const p of PRODUCTS) {
      order += 1;
      const existing = await prisma.product.findFirst({ where: { categoryId: category.id, name: p.name } });
      if (existing) {
        // created by the migration: add its picture
        if (!existing.imageUrl) {
          await prisma.product.update({ where: { id: existing.id }, data: { imageUrl: await upload(p.file, 'products') } });
          console.log(`Added the picture of ${p.name}`);
        }
        continue;
      }
      await prisma.product.create({
        data: {
          categoryId: category.id,
          name: p.name,
          description: p.description,
          imageUrl: await upload(p.file, 'products'),
          sortOrder: order,
          variants: { create: p.variants.map(([weight, price]) => ({ weight, price, costPrice: Math.round(price * 0.6), inStock: false })) },
        },
      });
      console.log(`Created ${p.name}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
