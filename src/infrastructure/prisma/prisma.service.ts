import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** Prisma transaction client - what repositories/services receive when they must join a transaction. */
export type Tx = Prisma.TransactionClient;

interface ModelInfo {
  name: string;
  dbName?: string | null;
  fields: { name: string; dbName?: string | null; kind: string }[];
}

/**
 * "table.column" entries the code expects but the database does not have. This is what a deploy looks like when the
 * new code is running but `prisma migrate deploy` was not run: every query on that table then fails (P2022).
 */
export function missingColumns(models: ModelInfo[], existing: { table_name: string; column_name: string }[]): string[] {
  const have = new Map<string, Set<string>>();
  for (const r of existing) {
    if (!have.has(r.table_name)) have.set(r.table_name, new Set());
    have.get(r.table_name)!.add(r.column_name);
  }
  const missing: string[] = [];
  for (const m of models) {
    const table = m.dbName ?? m.name;
    const cols = have.get(table);
    if (!cols) {
      missing.push(`${table} (table)`);
      continue;
    }
    for (const f of m.fields) {
      if (f.kind !== 'scalar' && f.kind !== 'enum') continue;
      const col = f.dbName ?? f.name;
      if (!cols.has(col)) missing.push(`${table}.${col}`);
    }
  }
  return missing;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
    // never blocks or fails the start: it only makes a missing migration impossible to overlook
    void this.schemaMissing()
      .then((missing) => {
        if (missing.length) {
          this.logger.error(
            `DATABASE IS BEHIND THE CODE: missing ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ` (+${missing.length - 12} more)` : ''}. ` +
              'Queries on these tables fail until the migrations are applied: docker compose -f docker-compose.prod.yml --env-file .env run --rm migrate',
          );
        }
      })
      .catch(() => undefined);
  }

  /** Columns the code expects that the database lacks (empty = the schema is up to date). */
  async schemaMissing(): Promise<string[]> {
    const rows = await this.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`;
    return missingColumns(Prisma.dmmf.datamodel.models as unknown as ModelInfo[], rows);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
