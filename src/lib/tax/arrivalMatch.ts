/**
 * arrivalMatch.ts: pick the on-chain arrival that belongs to an exchange withdrawal. Pure.
 *
 * Moved here unchanged from lifecycle.ts, which imports it back and still exports it
 * (tests/transferLink.test.ts imports it from there). The transfer resolver needs the same
 * guards and must not pull the lifecycle module's database import into a pure core.
 */

/** 6h: exchange to on-chain arrivals can be slow (BTC, congestion). Best match + arrival-after + tight tolerance guard against false links. */
export const LINK_WINDOW_MINUTES = 6 * 60;
/** 1%: covers network fees on small transfers without over-matching. */
export const AMOUNT_TOLERANCE = 0.01;

// Pick the best on-chain arrival to link to an exchange withdrawal. Best = closest in
// time (then amount), strictly AFTER the withdrawal, within window + amount tolerance,
// and not already linked. Pure + exported for unit tests. TAX-SENSITIVE: a false match
// hides a disposal, so the amount tolerance + best-match + arrival-after are the guards.
export type ArrivalCandidate = { source_id: string; direction: string | null; amount: number | null; timestamp_utc: string };
export function selectArrivalMatch(
	withdrawalAmount: number,
	withdrawalTimeMs: number,
	candidates: ArrivalCandidate[],
	alreadyLinked: Set<string>,
	windowMinutes: number,
	tolerancePct: number,
): ArrivalCandidate | null {
	let best: ArrivalCandidate | null = null;
	let bestScore = Infinity;
	const wAbs = Math.abs(withdrawalAmount);
	for (const c of candidates) {
		if (c.direction !== 'in' || c.amount === null) continue;
		if (alreadyLinked.has(c.source_id)) continue;
		const cTime = Date.parse(c.timestamp_utc) || 0;
		if (cTime < withdrawalTimeMs) continue; // an arrival cannot precede its own withdrawal
		const minutesApart = (cTime - withdrawalTimeMs) / 60000;
		if (minutesApart > windowMinutes) continue;
		const amountDiff = Math.abs(c.amount - wAbs);
		if (amountDiff > Math.max(wAbs, 1) * tolerancePct) continue;
		const score = minutesApart + (amountDiff / Math.max(wAbs, 1e-9)) * 1000; // closest time, then amount
		if (score < bestScore) { bestScore = score; best = c; }
	}
	return best;
}
