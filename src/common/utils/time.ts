const IST_OFFSET_MIN = 330;

/** Current time of day in IST as minutes since midnight. */
export function istMinutesNow(now = new Date()): number {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** "HH:mm" -> minutes since midnight, or null if malformed. */
export function parseHHmm(value?: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Parses "9:00 AM" / "09:00" into minutes since midnight. */
export function parseClock(value?: string | null): number {
  if (!value) return 0;
  const [time, modifier] = value.trim().split(' ');
  const [h, m] = time.split(':');
  let hours = parseInt(h, 10) || 0;
  const minutes = parseInt(m, 10) || 0;
  if (modifier) {
    const mod = modifier.toUpperCase();
    if (hours === 12) hours = mod === 'AM' ? 0 : 12;
    else if (mod === 'PM') hours += 12;
  }
  return hours * 60 + minutes;
}

/** Start (as a UTC instant) of the IST calendar day containing `now`. */
export function startOfIstDay(now = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const midnightIstAsUtc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(midnightIstAsUtc - IST_OFFSET_MIN * 60_000);
}

export type Period = 'today' | 'week' | 'month' | 'custom' | 'all';

export interface DateRange {
  start: Date;
  /** exclusive; null = open ended */
  end: Date | null;
}

/** IST-aligned [start, end) range for a dashboard/list period. null for 'all' or unknown. */
export function istRange(period: Period | string | undefined, startStr?: string, endStr?: string): DateRange | null {
  const OFFSET = IST_OFFSET_MIN * 60_000;
  const ist = new Date(Date.now() + OFFSET);
  const dayStart = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - OFFSET);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();

  switch (period) {
    case 'today':
      return { start: dayStart(y, m, d), end: null };
    case 'week':
      return { start: dayStart(y, m, d - ist.getUTCDay()), end: null };
    case 'month':
      return { start: dayStart(y, m, 1), end: null };
    case 'custom': {
      if (!startStr || !endStr) return null;
      const [sy, sm, sd] = startStr.split('-').map(Number);
      const [ey, em, ed] = endStr.split('-').map(Number);
      if ([sy, sm, sd, ey, em, ed].some((n) => !Number.isFinite(n))) return null;
      return { start: dayStart(sy, sm - 1, sd), end: dayStart(ey, em - 1, ed + 1) };
    }
    default:
      return null;
  }
}

/** Today's date in IST as YYYY-MM-DD. */
export const istToday = (now = new Date()): string => new Date(now.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);

export const toDateOnly = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
