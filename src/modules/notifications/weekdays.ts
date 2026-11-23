/** Days of the week for scheduled plans, Monday first. A plan with no days chosen runs every day. */
export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Chosen days -> unique, valid, in week order (Monday first). */
export function normalizeWeekdays(input: unknown): Weekday[] {
  const list = Array.isArray(input) ? input : String(input ?? '').split(/[\s,;]+/);
  const wanted = new Set(list.map((d) => String(d).trim().slice(0, 3).toUpperCase()));
  return WEEKDAYS.filter((d) => wanted.has(d));
}

/** Stored form: "FRI" / "SAT,SUN" / "" (every day). */
export const weekdaysToString = (days: unknown): string => {
  const d = normalizeWeekdays(days);
  return d.length === 7 ? '' : d.join(',');
};

/** The day of the week (IST) of a moment. */
export function istWeekday(now: Date): Weekday {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return WEEKDAYS[(ist.getUTCDay() + 6) % 7]; // getUTCDay: Sunday = 0
}

/** Does a plan with these stored days run on this day? Nothing chosen = every day. */
export function runsOn(stored: string | null | undefined, day: Weekday): boolean {
  const days = normalizeWeekdays(stored ?? '');
  return days.length === 0 || days.includes(day);
}

/** "Every day", "Every FRI", "Every SAT & SUN", "Every MON-THU" (3+ in a row), "Every MON, WED & FRI". */
export function weekdaysLabel(days: unknown): string {
  const d = normalizeWeekdays(days);
  if (d.length === 0 || d.length === 7) return 'Every day';
  if (d.length === 1) return `Every ${d[0]}`;
  const idx = d.map((x) => WEEKDAYS.indexOf(x));
  const inARow = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (d.length >= 3 && inARow) return `Every ${d[0]}-${d[d.length - 1]}`;
  return `Every ${d.slice(0, -1).join(', ')} & ${d[d.length - 1]}`;
}
