/**
 * Expected-status expressions: "200-399" (default), "200,204", "200-299,301".
 */

export const DEFAULT_EXPECTED_STATUS = "200-399";

type Range = readonly [number, number];

export function parseExpectedStatus(expr: string): Range[] | null {
  const ranges: Range[] = [];
  for (const part of expr.split(",")) {
    const match = /^\s*(\d{3})\s*(?:-\s*(\d{3})\s*)?$/.exec(part);
    if (!match) return null;
    const from = Number(match[1]);
    const to = Number(match[2] ?? match[1]);
    if (from < 100 || to > 599 || from > to) return null;
    ranges.push([from, to]);
  }
  return ranges.length > 0 ? ranges : null;
}

export function matchesExpectedStatus(status: number, expr: string): boolean {
  const ranges = parseExpectedStatus(expr) ?? parseExpectedStatus(DEFAULT_EXPECTED_STATUS)!;
  return ranges.some(([from, to]) => status >= from && status <= to);
}
