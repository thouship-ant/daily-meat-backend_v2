import { existsSync } from 'fs';

/**
 * Local overrides: `.env.local` (git-ignored) is read before anything else, so `npm run start:dev` on a developer machine
 * can use localhost addresses while `.env` keeps the in-Docker ones (db:5432, minio:9000). Must be the first import of
 * main.ts: Prisma reads `.env` on its own and never overrides a variable that is already set.
 */
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
