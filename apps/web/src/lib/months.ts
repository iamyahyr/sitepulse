/** Calendar months in UTC, keyed "YYYY-MM", like the hourly rollups they are built from. */

export type Month = { key: string; from: Date; to: Date; label: string };

const LABEL = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

export function monthOf(year: number, monthIndex: number): Month {
  const from = new Date(Date.UTC(year, monthIndex, 1));
  const to = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { key: from.toISOString().slice(0, 7), from, to, label: LABEL.format(from) };
}

/** "2026-10" → that month; anything else → null. */
export function parseMonth(key: string | undefined): Month | null {
  const match = key?.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return match ? monthOf(Number(match[1]), Number(match[2]) - 1) : null;
}

export const previousMonth = (month: Month) => monthOf(month.from.getUTCFullYear(), month.from.getUTCMonth() - 1);

/** The current month first, then the `count - 1` before it. */
export function recentMonths(now: Date, count: number): Month[] {
  return Array.from({ length: count }, (_, i) => monthOf(now.getUTCFullYear(), now.getUTCMonth() - i));
}
