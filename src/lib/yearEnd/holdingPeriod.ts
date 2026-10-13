/**
 * Short-term vs long-term: the holding-period rule both gain engines share.
 *
 * Long-term means held MORE than one year, counted in calendar months, not days
 * (26 U.S.C. 1222; Rev. Rul. 66-7; IRS Publication 544, "Holding Period"). The
 * holding period starts the day after acquisition and includes the day of sale, so:
 *
 *   bought Feb 5, 2024, sold Feb 5, 2025  → exactly one year → short-term
 *   bought Feb 5, 2024, sold Feb 6, 2025  → more than a year → long-term
 *
 * The comparison is by calendar date, never by time of day: a sale late on the
 * anniversary is still exactly one year. A 365-day count gets the anniversary wrong
 * (365 days ends one day early) and drifts across leap years.
 *
 * Dates are UTC calendar dates, the timezone every stored timestamp uses.
 *
 * Feb 29: the anniversary in a year without one is Feb 28. Counting months from the
 * day after acquisition (Mar 1), twelve months run through Feb 28, so a Mar 1 sale is
 * more than one year.
 */

/** A UTC calendar date as a comparable number, YYYYMMDD (month is 0-based in, 1-based out). */
function utcDateKey(year: number, month: number, day: number): number {
	return year * 10_000 + (month + 1) * 100 + day;
}

function daysInUtcMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** True when the disposal is more than one year after the acquisition (long-term). */
export function isLongTermHold(acquiredAt: string, disposedAt: string): boolean {
	const acq = new Date(acquiredAt);
	const disp = new Date(disposedAt);
	// An unreadable date can't prove more than a year: short-term, so nothing reads
	// long-term without evidence.
	if (Number.isNaN(acq.getTime()) || Number.isNaN(disp.getTime())) return false;
	const year = acq.getUTCFullYear() + 1;
	const month = acq.getUTCMonth();
	const day = Math.min(acq.getUTCDate(), daysInUtcMonth(year, month));
	const anniversary = utcDateKey(year, month, day);
	return utcDateKey(disp.getUTCFullYear(), disp.getUTCMonth(), disp.getUTCDate()) > anniversary;
}

/** True when held one year or less (short-term). */
export function isShortTermHold(acquiredAt: string, disposedAt: string): boolean {
	return !isLongTermHold(acquiredAt, disposedAt);
}

/**
 * Whole days from `asOf` until the holding first counts as long-term (the day after the
 * anniversary); 0 once it already does. Null for an unreadable date.
 */
export function daysUntilLongTerm(acquiredAt: string, asOf: string): number | null {
	const acq = new Date(acquiredAt);
	const ref = new Date(asOf);
	if (Number.isNaN(acq.getTime()) || Number.isNaN(ref.getTime())) return null;
	if (isLongTermHold(acquiredAt, asOf)) return 0;
	const year = acq.getUTCFullYear() + 1;
	const month = acq.getUTCMonth();
	const day = Math.min(acq.getUTCDate(), daysInUtcMonth(year, month));
	const firstLongTermDay = Date.UTC(year, month, day + 1);
	const refDay = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
	return Math.round((firstLongTermDay - refDay) / 86_400_000);
}
