/** Checks a 12-digit Aadhaar number with the Verhoeff checksum (the last digit is a check digit). */
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function isValidAadhaar(raw: string): boolean {
  const digits = String(raw ?? '').replace(/\s|-/g, '');
  if (!/^[2-9]\d{11}$/.test(digits)) return false; // Aadhaar numbers never start with 0 or 1
  let c = 0;
  digits.split('').reverse().forEach((ch, i) => {
    c = D[c][P[i % 8][Number(ch)]];
  });
  return c === 0;
}

/** Indian registration number such as TN45AB1234 / TN 45 AB 1234 / TN45A1234 (spaces and dashes ignored). */
export function normalizeRegNo(raw: string): string | null {
  const v = String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(v) ? v : null;
}

export function isValidVehicleYear(year: number, now = new Date()): boolean {
  return Number.isInteger(year) && year >= 1990 && year <= now.getFullYear() + 1;
}
