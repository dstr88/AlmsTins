/**
 * Ledger timestamps (import_transactions.timestamp_utc, tax_lots.acquired_at,
 * tax_disposals.disposed_at, ...) are TEXT columns meant to hold ISO-8601 UTC. Year filters
 * read the first four characters and date math casts to timestamptz, so both depend on the
 * stored text really being ISO-8601 UTC. These helpers keep the write side and the read side
 * honest.
 */

// Date, optional time (seconds and fraction optional), optional zone (Z or a +/-HH[:MM] offset).
const ISO_8601 = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)? ?([Zz]|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * Normalize an ISO-8601 timestamp to UTC `YYYY-MM-DDTHH:mm:ss.sssZ`. A value with no zone is
 * read as UTC; an offset is converted, so '2024-01-01T02:00:00+05:00' becomes
 * '2023-12-31T21:00:00.000Z'. Returns null for anything that is not ISO-8601 or not a real
 * calendar instant (no month-name formats, no AM/PM, no Feb 30), so a caller never stores text
 * that the year filters and date casts would misread.
 */
export function toUtcIso(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const m = ISO_8601.exec(raw.trim());
	if (!m) return null;
	const [, y, mo, d, hh = '0', mi = '0', ss = '0', frac = '', zone = ''] = m;
	const ms = frac ? Math.floor(Number(`0.${frac}`) * 1000) : 0;
	const wall = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss, ms));
	// Date.UTC rolls out-of-range fields over (Feb 30 -> Mar 1, hour 24 -> next day) and maps
	// years 0-99 to 1900-1999; a round trip that changes any field means the input was invalid.
	if (
		wall.getUTCFullYear() !== +y || wall.getUTCMonth() !== +mo - 1 || wall.getUTCDate() !== +d ||
		wall.getUTCHours() !== +hh || wall.getUTCMinutes() !== +mi || wall.getUTCSeconds() !== +ss
	) {
		return null;
	}
	let offsetMinutes = 0;
	if (zone && zone.toUpperCase() !== 'Z') {
		const zh = Number(zone.slice(1, 3));
		const zm = Number(zone.slice(3).replace(':', '') || '0');
		if (zh > 15 || zm > 59) return null;
		offsetMinutes = (zone[0] === '-' ? -1 : 1) * (zh * 60 + zm);
	}
	return new Date(wall.getTime() - offsetMinutes * 60_000).toISOString();
}

// The same shape as ISO_8601, with field ranges, as a Postgres regex. Character classes only:
// no backslashes (a template literal would eat them) and no apostrophes.
const SQL_ISO_8601 =
	'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])' +
	'([T ]([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9]([.][0-9]+)?)?)?' +
	' ?([Zz]|[+-][01][0-9](:?[0-5][0-9])?)?$';

/**
 * SQL for `column` cast to timestamptz, or NULL when the text is not ISO-8601 shaped (for
 * example a raw 'Sep 9 2024 5:50PM ET' an importer kept as-is), so one malformed row drops out
 * of the comparison instead of making the whole statement throw. A zone-less value is read in
 * the session time zone, which db.pg.ts pins to UTC. `column` is interpolated into the SQL, so
 * it must be a fixed column reference, never user input.
 */
export function sqlTimestamptz(column: string): string {
	if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i.test(column)) {
		throw new Error(`sqlTimestamptz: not a column reference: ${column}`);
	}
	return `CASE WHEN ${column} ~ '${SQL_ISO_8601}' THEN CAST(${column} AS timestamptz) END`;
}
