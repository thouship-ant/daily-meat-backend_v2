/** Excel-safe cell: shown as text so long numbers (phone, pincode) are never turned into 9.87E+09 or lose a leading 0. */
export const asText = (v: string | null | undefined): string => (v ? `="${String(v).replace(/"/g, '""')}"` : '');

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with a UTF-8 BOM so Excel reads Tamil / accented names correctly. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(cell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
