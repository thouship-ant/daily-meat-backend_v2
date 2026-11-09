import { Prisma } from '@prisma/client';

/**
 * Makes Prisma results JSON friendly: Decimal -> number, BigInt -> number, Date stays (JSON.stringify makes ISO).
 * Walks plain objects/arrays only, so class instances (e.g. Buffers) are left alone.
 */
export function serialize<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toNumber();
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(walk);
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v);
    return out;
  }
  return value;
}
