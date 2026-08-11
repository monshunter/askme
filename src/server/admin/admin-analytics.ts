import type { AdminRange } from "./admin-input";

export const ADMIN_RANGE_DAYS: Record<AdminRange, number> = { "7d": 7, "30d": 30, "90d": 90 };

export function buildUtcDateBuckets(now: Date | string, days: number) {
  const end = new Date(now);
  if (!Number.isFinite(end.getTime()) || !Number.isInteger(days) || days < 1) throw new Error("A valid date and positive day count are required.");
  const dates: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - offset));
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

export function comparableChange(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return Math.round((((current - previous) / previous) * 100) * 10) / 10;
}

export function adminRangeWindow(range: AdminRange, now = new Date()) {
  const days = ADMIN_RANGE_DAYS[range];
  const end = new Date(now);
  const start = new Date(end.getTime() - days * 86_400_000);
  const previousStart = new Date(start.getTime() - days * 86_400_000);
  return { days, start, end, previousStart };
}
