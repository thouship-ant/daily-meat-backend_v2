import { createHash } from 'crypto';

/** "+91 98765-43210", "9876543210" -> "+919876543210"; null when it is not an Indian mobile number. */
export function normalizeSimNumber(raw: string): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  const last10 = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(last10) ? `+91${last10}` : null;
}

/**
 * One id for "this phone's SIM numbers": a hash of the sorted numbers. Two numbers or more are needed (one SIM cannot
 * tell two instances of the app apart from anything else). The numbers themselves are never stored.
 */
export function simGroupOf(numbers: string[] | undefined | null): string | null {
  const list = Array.from(new Set((numbers ?? []).map(normalizeSimNumber).filter((n): n is string => !!n))).sort();
  if (list.length < 2) return null;
  return createHash('sha256').update(list.join('|')).digest('hex');
}
