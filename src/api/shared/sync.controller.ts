import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { CacheService } from '../../infrastructure/cache/cache.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * One short fingerprint per kind of master data. The apps keep these lists (slots, catalog, drivers ...) on the phone and
 * ask the server only "did anything change?": a different fingerprint means that list changed, so it is fetched again;
 * the same fingerprint means nothing is downloaded at all. A fingerprint is an md5 over the rows' ids and their
 * last-changed time (or, for users, the fields an admin sees), so inserts, edits and deletes all change it, including
 * changes made outside the API. It carries no data itself.
 */
export const SYNC_RESOURCES: Record<string, string> = {
  slots: `SELECT id::text AS k, "updatedAt"::text AS v FROM delivery_slots`,
  // categories, products and their variants are one catalog: a price change must refresh the product lists
  catalog: `SELECT id::text AS k, "updatedAt"::text AS v FROM categories
            UNION ALL SELECT id::text, "updatedAt"::text FROM products
            UNION ALL SELECT id::text, "updatedAt"::text FROM product_variants`,
  banners: `SELECT id::text AS k, "updatedAt"::text AS v FROM banners`,
  hubs: `SELECT id::text AS k, "updatedAt"::text AS v FROM shop_settings`,
  coupons: `SELECT id::text AS k, "updatedAt"::text AS v FROM coupons`,
  // users.updatedAt moves every time someone opens the app (last active), so the fields an admin actually sees are used
  drivers: `SELECT 'u:' || id::text AS k, concat_ws('|', name, phone, email, is_active, role)  AS v FROM users WHERE role = 'DRIVER'
            UNION ALL SELECT 'p:' || user_id::text, concat_ws('|', status, updated_at::text, hub_id) FROM driver_profiles`,
  driverApplications: `SELECT user_id::text AS k, updated_at::text AS v FROM driver_profiles
                       UNION ALL SELECT id::text, updated_at::text FROM driver_interests`,
  customers: `SELECT id::text AS k, concat_ws('|', name, phone, email, is_active) AS v FROM users WHERE role = 'CUSTOMER'`,
};

const CACHE_SECONDS = 5; // the apps poll; the database is asked at most once every few seconds however many phones ask

@ApiTags('Public')
@Public()
@Controller('sync')
export class SyncController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  @Get('versions')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Fingerprint of each kind of master data, so an app can tell whether its saved copy is still current' })
  async versions() {
    return this.cache.wrap('sync:versions', CACHE_SECONDS, async () => {
      const entries = await Promise.all(
        Object.entries(SYNC_RESOURCES).map(async ([name, sql]) => {
          // the SQL is a fixed constant above (no user input)
          const rows = await this.prisma.$queryRawUnsafe<{ h: string }[]>(
            `SELECT md5(coalesce(string_agg(k || ':' || coalesce(v, ''), ',' ORDER BY k), '')) AS h FROM (${sql}) t`,
          );
          return [name, rows[0]?.h ?? ''] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<string, string>;
    });
  }
}
