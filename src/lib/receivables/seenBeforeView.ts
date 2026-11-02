/**
 * "Seen before?" result view (S6): turns one answer from POST /api/verify/receivables/check into
 * the lines the form shows, and nothing more. Pure and client-safe: no fetch, no DOM, no copy of
 * its own — every word comes from copy/seenBefore.ts, held to the bright line by
 * tests/receivables/copy.test.ts. Only neutral values (a count, a date) are interpolated here.
 *
 * The client normalizes its fetch into a SeenBeforeOutcome (by HTTP status and tier) and calls
 * seenBeforeView() to render. A match is a caution, never a clearance; "not found" is never a clean
 * bill; "unavailable" is an error, never read as "not found". The answer warns; the person decides.
 */
import type { SeenBeforeAnswer } from './seenBefore';
import {
	SEEN_BEFORE_AFFIRMED_ALL,
	SEEN_BEFORE_AFFIRMED_NONE,
	SEEN_BEFORE_AFFIRMED_SOME,
	SEEN_BEFORE_DEBTOR_CONFIRMED,
	SEEN_BEFORE_DEBTOR_DISPUTED,
	SEEN_BEFORE_FINANCED,
	SEEN_BEFORE_FIN_FULL,
	SEEN_BEFORE_FIN_OVER,
	SEEN_BEFORE_FIN_PARTIAL,
	SEEN_BEFORE_FIRST_SEEN_PREFIX,
	SEEN_BEFORE_MATCHES_FEW,
	SEEN_BEFORE_MATCHES_MANY,
	SEEN_BEFORE_MATCHES_ONE,
	SEEN_BEFORE_MATCH_CAVEAT,
	SEEN_BEFORE_NOT_FOUND_MEANING,
	SEEN_BEFORE_ON_RECORD,
	SEEN_BEFORE_RATE_LIMITED,
	SEEN_BEFORE_REF_DIFF,
	SEEN_BEFORE_REF_MATCH,
	SEEN_BEFORE_SETTLED,
	SEEN_BEFORE_STALE_PREFIX,
	SEEN_BEFORE_VERIFY_FOR_MORE,
	SEEN_BEFORE_WITHDRAWN,
} from './copy/seenBefore';

/** What a verified account sees (full answer) versus any other signed-in account (found only). */
export type SeenBeforeOutcome =
	| { kind: 'signin'; message: string; signInHref: string }
	| { kind: 'blocked'; message: string } // demo (403): an on-screen message, no answer
	| { kind: 'rate_limited' } // 429
	| { kind: 'invalid'; message: string } // 400, the field problem
	| { kind: 'unavailable'; message: string } // 503, never an answer about the invoice
	| { kind: 'found_only'; found: boolean } // signed in, not verified
	| { kind: 'full'; answer: SeenBeforeAnswer }; // signed in and verified

export type SeenBeforeTone = 'caution' | 'muted' | 'info' | 'error' | 'signin';

export interface SeenBeforeView {
	tone: SeenBeforeTone;
	/** First line reads as the heading; the rest are detail. Rendered with textContent only. */
	lines: string[];
	/** Present only for a 401: the financing sign-in, returning to this page. */
	signInHref?: string;
}

/** "One matching record…", "3 matching records…", or "Five or more…". n is 0..5 (5 means 5+). */
function matchesLine(n: number): string {
	if (n >= 5) return SEEN_BEFORE_MATCHES_MANY;
	if (n === 1) return SEEN_BEFORE_MATCHES_ONE;
	return `${n} ${SEEN_BEFORE_MATCHES_FEW}`;
}

/** The lines for a verified account's full answer when a match was found. */
function fullFoundLines(a: SeenBeforeAnswer): string[] {
	const lines: string[] = [];
	// Heading: financed outranks settled outranks recorded (mirrors answer.status).
	lines.push(a.anyFinanced ? SEEN_BEFORE_FINANCED : a.anySettled ? SEEN_BEFORE_SETTLED : SEEN_BEFORE_ON_RECORD);
	lines.push(matchesLine(a.matches));
	if (a.financing === 'partial') lines.push(SEEN_BEFORE_FIN_PARTIAL);
	else if (a.financing === 'full') lines.push(SEEN_BEFORE_FIN_FULL);
	else if (a.financing === 'over') lines.push(SEEN_BEFORE_FIN_OVER);
	if (a.anyFinanced) {
		lines.push(
			a.claimsAffirmed === 'all' ? SEEN_BEFORE_AFFIRMED_ALL
				: a.claimsAffirmed === 'some' ? SEEN_BEFORE_AFFIRMED_SOME
					: SEEN_BEFORE_AFFIRMED_NONE,
		);
	}
	// The freshness story (A3): past its promised date and not updated — the checker revalidates.
	// Active and in-grace financing reads as it always did; lapsed never reaches this answer.
	if (a.anyStale && a.staleSince) lines.push(SEEN_BEFORE_STALE_PREFIX + a.staleSince + '.');
	if (a.debtor === 'disputed') lines.push(SEEN_BEFORE_DEBTOR_DISPUTED);
	else if (a.debtor === 'confirmed') lines.push(SEEN_BEFORE_DEBTOR_CONFIRMED);
	if (a.withdrawn) lines.push(SEEN_BEFORE_WITHDRAWN);
	if (a.refChecked) lines.push(a.refMatch ? SEEN_BEFORE_REF_MATCH : SEEN_BEFORE_REF_DIFF);
	if (a.firstSeen) lines.push(SEEN_BEFORE_FIRST_SEEN_PREFIX + a.firstSeen + '.');
	lines.push(SEEN_BEFORE_MATCH_CAVEAT);
	return lines;
}

/** The view for one normalized outcome. */
export function seenBeforeView(outcome: SeenBeforeOutcome): SeenBeforeView {
	switch (outcome.kind) {
		case 'signin':
			return { tone: 'signin', lines: [outcome.message], signInHref: outcome.signInHref };
		case 'blocked':
			return { tone: 'info', lines: [outcome.message] };
		case 'rate_limited':
			return { tone: 'error', lines: [SEEN_BEFORE_RATE_LIMITED] };
		case 'invalid':
			return { tone: 'error', lines: [outcome.message] };
		case 'unavailable':
			return { tone: 'error', lines: [outcome.message] };
		case 'found_only':
			return outcome.found
				? { tone: 'caution', lines: [SEEN_BEFORE_ON_RECORD, SEEN_BEFORE_VERIFY_FOR_MORE] }
				: { tone: 'muted', lines: [SEEN_BEFORE_NOT_FOUND_MEANING] };
		case 'full':
			return outcome.answer.found
				? { tone: 'caution', lines: fullFoundLines(outcome.answer) }
				: { tone: 'muted', lines: [SEEN_BEFORE_NOT_FOUND_MEANING] };
	}
}
