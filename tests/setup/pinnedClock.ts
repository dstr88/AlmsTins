/**
 * Pin the suite's wall clock, so no test depends on the day it runs (plan convention 6: hermetic
 * tests only; the CI gate must answer the same on any date).
 *
 * Why: claim aging (receivables A1) derives state from elapsed time — a claim nobody maintained
 * for LAPSE_AFTER_DAYS reads lapsed and stops counting toward headroom. Fixtures across the suite
 * carry fixed 2026 dates; against the real clock they would age, and sums pinned by
 * characterization tests would change on the day the calendar crossed a boundary. A pinned Date
 * keeps every fixture the same distance from "now" forever.
 *
 * How: the global Date is replaced with a subclass whose zero-argument constructor and now()
 * answer a fixed instant. Deliberately NOT vi.useFakeTimers here: a sinon clock installed by the
 * setup would already own the timers when a test file calls vi.useFakeTimers() itself, and those
 * files (golden reports, rate gates, the agentics timeouts) would silently keep REAL timers.
 * With a plain subclass, their vi.useFakeTimers() installs over it and vi.useRealTimers()
 * restores back to it — both work exactly as before, and a sinon clock started without an
 * explicit `now` starts from the pinned instant, which is the point.
 *
 * setTimeout/setInterval are untouched: only the notion of "today" is pinned. The instant sits
 * after the suite's past-dated fixtures and before its future-dated ones (seeded due dates of
 * 2026-12-01 stay in the future). New tests should still pass `now` explicitly wherever the code
 * takes one — this pin is the backstop, not the pattern.
 */

/** The opt-in suites that run against a REAL Postgres (CI's integration steps, the pg*
 *  diagnostics) keep the real clock: their rows carry database-side now() timestamps, and a
 *  pinned app clock beside a real database clock would mean two different "now"s in one test. */
const optedIntoRealDatabase =
	process.env.RUN_TAX_PIPELINE_IT === '1' ||
	process.env.RUN_PG_AGENTICS_LIMITS === '1' ||
	process.env.RUN_PG_DIAGNOSTICS === '1';

const PINNED_MS = Date.parse('2026-11-05T12:00:00Z');
const RealDate = globalThis.Date;

class PinnedDate extends RealDate {
	constructor(...args: unknown[]) {
		if (args.length === 0) {
			super(PINNED_MS);
		} else {
			// Same arity behavior as the real Date (one value, or year/month/… parts).
			super(...(args as [number]));
		}
	}
	static now(): number {
		return PINNED_MS;
	}
}

if (!optedIntoRealDatabase) {
	globalThis.Date = PinnedDate as unknown as DateConstructor;
}
