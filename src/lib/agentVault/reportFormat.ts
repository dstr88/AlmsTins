/**
 * How the Reports page and the signed PDF write numbers and times: dollars with cents, counts with
 * thousands separators, and times in UTC. Pure, so the page and the PDF agree to the character.
 * Every time in a report is UTC and says so.
 */
import { formatFileDate, formatUsd as sharedUsd, formatUtc } from '@/lib/format';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const COUNT = new Intl.NumberFormat('en-US');

/** `$1,270.56`, `-$5.00` (src/lib/format.ts). */
export const formatUsd = (usd: number): string => sharedUsd(usd);

/** `1,284`. */
export const formatCount = (n: number): string => COUNT.format(n);

/** `1 address`, `2 addresses`. */
export const plural = (n: number, one: string, many: string): string => `${formatCount(n)} ${n === 1 ? one : many}`;

const ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/;

/** `2026-10-18 09:10:00 UTC`: moved to src/lib/format.ts, re-exported for the report and PDF. */
export { formatUtc };

/** `09:10:00` from an ISO-8601 UTC time. Anything that is not one is shown as it is. */
export function formatClock(iso: string): string {
  const m = ISO.exec(iso);
  return m ? m[2] : iso;
}

/** `October 17, 2026` from `2026-10-17`. */
export function formatDayLong(day: string): string {
  return DAY.test(day) ? formatFileDate(day, { style: 'long' }) : day;
}

/** `Oct 17` from `2026-10-17`, for a short subject line. */
export function formatDayShort(day: string): string {
  return DAY.test(day) ? formatFileDate(day, { style: 'dayMonth' }) : day;
}
