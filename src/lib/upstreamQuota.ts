/**
 * In-process daily quota guard for paid upstream APIs (VirusTotal, Google Safe
 * Browsing). A backstop, not an accountant: the DB scan cache removes most
 * calls; this stops a cache-miss storm (many never-before-seen URLs, or a
 * slow-rotating-IP attacker) from exhausting a source's daily quota and taking
 * it down for everyone.
 *
 * Per-process and resets when the UTC day changes. On Render the web service
 * runs a single process (WEB_CONCURRENCY=1), so one counter covers all traffic;
 * a deploy resets it, which is fine for a safety ceiling. Set the max BELOW the
 * provider's real daily limit so there's always headroom (never a hard block
 * from the provider, which can trigger penalties).
 */
const counters = new Map<string, { day: string; count: number }>();

/**
 * Try to consume one unit of `source`'s daily budget. Returns true if under the
 * cap (and increments), false if the cap is reached (caller should skip the call).
 */
export function tryConsumeDailyQuota(source: string, dailyMax: number): boolean {
	const day = new Date().toISOString().slice(0, 10); // UTC day
	const c = counters.get(source);
	if (!c || c.day !== day) {
		counters.set(source, { day, count: 1 });
		return true;
	}
	if (c.count >= dailyMax) return false;
	c.count += 1;
	return true;
}
