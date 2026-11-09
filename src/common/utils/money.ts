/** Rounds to 2 decimals. All money goes through this to avoid float drift (e.g. 0.1 + 0.2). */
export function toMoney(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
