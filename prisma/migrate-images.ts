/**
 * One-off: copy the catalog images (products, categories, banners) from Supabase Storage to your own S3-compatible
 * storage (MinIO on the VPS) and point the database at the new URLs.
 *
 *   docker compose -f docker-compose.prod.yml --env-file .env run --rm tools npx ts-node prisma/migrate-images.ts --dry-run
 *   docker compose -f docker-compose.prod.yml --env-file .env run --rm tools npx ts-node prisma/migrate-images.ts
 *
 * Needs AWS_ENDPOINT / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_BUCKET / S3_PUBLIC_BASE_URL (the NEW storage).
 * Safe to run again: files already in the new bucket are not downloaded twice, rows already on the new URL are left
 * alone, and a row is only changed after its file is in the new bucket. The old files are never touched or deleted.
 * Supabase must be serving files while this runs (a 402 means the project is still restricted).
 */
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

const DRY = process.argv.includes('--dry-run');
const OLD_HOST = /supabase\.co\/storage\/v1\/object\/public\//;
const CONCURRENCY = 4;

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};

const endpoint = need('AWS_ENDPOINT');
const bucket = need('S3_BUCKET');
const publicBase = need('S3_PUBLIC_BASE_URL').replace(/\/$/, '');
if (/supabase\.co/.test(endpoint) || /supabase\.co/.test(publicBase)) {
  throw new Error('AWS_ENDPOINT / S3_PUBLIC_BASE_URL still point at Supabase - set them to the new storage first.');
}

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId: need('AWS_ACCESS_KEY_ID'), secretAccessKey: need('AWS_SECRET_ACCESS_KEY') },
});
const prisma = new PrismaClient();

interface Row { table: 'product' | 'category' | 'banner'; id: string; url: string; key: string }

/** ".../object/public/<bucket>/<key>" -> the decoded <key> (the bucket name is dropped; keys are kept as they are). */
function keyOf(url: string): string {
  const path = new URL(url).pathname.replace(/^\/storage\/v1\/object\/public\//, '');
  return path.split('/').slice(1).map(decodeURIComponent).join('/');
}
const newUrl = (key: string) => `${publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`;

async function exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function load(): Promise<Row[]> {
  const rows: Row[] = [];
  const add = (table: Row['table'], list: { id: string; imageUrl: string | null }[]) => {
    for (const r of list) if (r.imageUrl && OLD_HOST.test(r.imageUrl)) rows.push({ table, id: r.id, url: r.imageUrl, key: keyOf(r.imageUrl) });
  };
  add('product', await prisma.product.findMany({ select: { id: true, imageUrl: true } }));
  add('category', await prisma.category.findMany({ select: { id: true, imageUrl: true } }));
  add('banner', await prisma.banner.findMany({ select: { id: true, imageUrl: true } }));
  return rows;
}

async function main() {
  const rows = await load();
  const byKey = new Map<string, string>(); // key -> a source URL
  rows.forEach((r) => byKey.set(r.key, r.url));
  console.log(`${rows.length} database rows use Supabase images (${byKey.size} different files). ${DRY ? 'DRY RUN - nothing is copied or changed.' : ''}`);
  if (!rows.length) return;

  const done = new Set<string>(); // keys that are in the new bucket
  const failed: { key: string; why: string }[] = [];
  let copied = 0;
  let already = 0;
  let blocked = 0;

  const queue = [...byKey.entries()];
  const worker = async () => {
    for (;;) {
      if (blocked >= 3) return; // Supabase is restricted - stop hammering it
      const next = queue.shift();
      if (!next) return;
      const [key, url] = next;
      if (await exists(key)) { already++; done.add(key); continue; }
      if (DRY) { copied++; continue; }
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (res.status === 402) { blocked++; failed.push({ key, why: 'HTTP 402 (Supabase project restricted)' }); continue; }
        if (!res.ok) { failed.push({ key, why: `HTTP ${res.status}` }); continue; }
        const body = Buffer.from(await res.arrayBuffer());
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: res.headers.get('content-type') || 'image/jpeg',
          CacheControl: 'public, max-age=31536000, immutable',
        }));
        copied++;
        done.add(key);
      } catch (e) {
        failed.push({ key, why: (e as Error).message });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (DRY) {
    console.log(`Would copy ${copied} files; ${already} are already in the new bucket.`);
    return;
  }
  if (blocked >= 3) console.error('\nStopped: Supabase answered 402 (project restricted). Restore the project, then run this again.');

  // Point the rows at the new URLs - only those whose file is now in the new bucket
  let updated = 0;
  for (const r of rows) {
    if (!done.has(r.key)) continue;
    const data = { imageUrl: newUrl(r.key) };
    if (r.table === 'product') await prisma.product.update({ where: { id: r.id }, data });
    else if (r.table === 'category') await prisma.category.update({ where: { id: r.id }, data });
    else await prisma.banner.update({ where: { id: r.id }, data });
    updated++;
  }

  console.log(`\nCopied ${copied} files (${already} were already there). Updated ${updated} of ${rows.length} rows.`);
  if (failed.length) {
    console.error(`${failed.length} file(s) failed:`);
    failed.slice(0, 20).forEach((f) => console.error(`  ${f.key}: ${f.why}`));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
