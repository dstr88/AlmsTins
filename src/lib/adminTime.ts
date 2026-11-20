/**
 * How a time reads on the owner's admin pages: in the viewer's own time zone, with the zone
 * named.
 *
 * The admin pages are rendered on the server, which does not know the viewer's zone. So the
 * server writes each time as a machine-readable <time datetime> whose text is UTC and says so
 * (adminTimeUtcText), and a small browser script rewrites the text in the viewer's zone
 * (adminTimeLocalText; src/components/admin/adminTime.client.ts). Before the script runs, or
 * without it, the page still reads correctly: every time is labeled UTC.
 *
 * Pure and isomorphic (no DOM, no Node): the server component and the browser script import the
 * same functions. English only, like the admin pages. The formatting itself is the app's one
 * date formatter (src/lib/format.ts); this file only decides which zone and whether to name it.
 */
import { formatDate, formatDateTime, localTimeZone, toDate } from './format';

/** `datetime`: a day and a time of day. `date`: the day alone. */
export type AdminTimeMode = 'datetime' | 'date';

/** The admin pages are English only. */
const LANG = 'en';

/** The instant as ISO 8601, for a <time datetime>. Null when the value is not a time. */
export function adminTimeIso(value: unknown): string | null {
	return toDate(value)?.toISOString() ?? null;
}

/** What the server writes: `Nov 20, 2026, 12:58 AM UTC` (or `Nov 20, 2026 UTC`). Null when unreadable. */
export function adminTimeUtcText(value: unknown, mode: AdminTimeMode = 'datetime'): string | null {
	const at = toDate(value);
	if (!at) return null;
	const text = mode === 'date' ? formatDate(at, LANG, { timeZone: 'UTC' }) : formatDateTime(at, LANG, { timeZone: 'UTC' });
	return `${text} UTC`;
}

/**
 * What the browser shows: `Nov 19, 2026, 6:58 PM CST`, the viewer's zone, named in the time
 * itself (so a summer date reads CDT and a winter one CST). A day alone reads `Nov 19, 2026`:
 * the page's zone note (adminZoneNote) names the zone once for those. `timeZone` is for tests;
 * the browser's own zone is the default. Null when unreadable.
 */
export function adminTimeLocalText(value: unknown, mode: AdminTimeMode = 'datetime', timeZone?: string): string | null {
	const at = toDate(value);
	if (!at) return null;
	return mode === 'date' ? formatDate(at, LANG, { timeZone }) : formatDateTime(at, LANG, { timeZone, zoneName: true });
}

/** The line that names the zone every time on the page is shown in: `Times in America/Chicago`. */
export function adminZoneNote(timeZone?: string): string {
	return `Times in ${timeZone ?? (localTimeZone() || 'your local time')}`;
}

/** The same line before the browser script runs: the server's times are UTC. */
export const ADMIN_ZONE_NOTE_UTC = 'Times in UTC';

/** A stored UTC calendar day (YYYY-MM-DD) as the admin pages write it: `Nov 19, 2026`. Never shifted to another zone. */
export function adminUtcDayText(day: string | null | undefined): string | null {
	const text = String(day ?? '').trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !toDate(text)) return null;
	return formatDate(text, LANG, { timeZone: 'UTC' });
}
