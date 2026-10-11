// Pure matching for src/scripts/backfillAttestationSource.mjs (tested in
// tests/receivables/attestationSourceBackfill.test.ts). No database access here.

/** The four consent flows, as each request-link answer writes its attestation. */
export const CONSENT_FLOWS = [
	{ source: 'debtor_confirmation', role: 'buyer', opening: 'Confirms invoice ', by: 'Answered by ',
		inviteMatches: (i) => i.role === 'buyer' },
	{ source: 'receipt_confirmation', role: 'supplier', opening: 'Confirms receipt of ', by: 'Answered by ',
		inviteMatches: (i) => i.role !== 'buyer' && !!i.claim_id },
	{ source: 'record_confirmation', role: 'supplier', opening: 'Confirms this is their receivable:', by: 'Answered by ',
		inviteMatches: (i) => i.role !== 'buyer' && !i.claim_id && !i.offer_id },
	{ source: 'offer_acceptance', role: 'supplier', opening: 'Accepts financing of ', by: 'Accepted by ',
		inviteMatches: (i) => i.role !== 'buyer' && !!i.offer_id },
];

const VIA = ' via a single-use link';
// The time proof runs on created_at, the database's own insert stamp. attested_at is the
// signed manifest's date ("2026-09-05", no time of day), so it can only be checked by day.
// Each answer claims its link and then writes the attestation in the same request, with
// nothing but database work in between.
const BEFORE_MS = 60_000;        // clock slack: accepted_at is the app's clock, created_at the database's
const AFTER_MS = 2 * 60_000;

/** The rules, in the order the dry run reports the first one an unmatched row fails. */
export const RULES = ['receivable', 'tenant', 'kind', 'answerer', 'window', 'day'];

/** "2026-09-05 14:03:11", "2026-09-05T14:03:11Z" or "...T14:03:11.123Z" as UTC milliseconds. */
export function utcMs(s) {
	if (!s) return NaN;
	const v = String(s).trim().replace(' ', 'T');
	return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + 'Z');
}

const day = (s) => String(s ?? '').trim().slice(0, 10);

/**
 * Which NULL-source attestations provably came through a request link, and as which source.
 * attestations: { id, receivable_id, tenant_id, role, statement, attested_at (YYYY-MM-DD), created_at, source }
 * invites:      { token, receivable_id, from_tenant, role, accepted_at, accepted_by, claim_id, offer_id }
 * Returns { tags: [{ id, source }], counts: { [source]: { candidates, provable, ambiguous, unmatched, why } } },
 * where `why` counts each unmatched row under the first rule (RULES) that left it no link.
 */
export function matchAttestationSources(attestations, invites) {
	const counts = {};
	const tags = [];
	const answered = invites.filter((i) => i.accepted_at && i.accepted_by);
	for (const flow of CONSENT_FLOWS) {
		const candidates = attestations.filter((a) =>
			a.source == null && a.role === flow.role &&
			String(a.statement).startsWith(flow.opening) && String(a.statement).includes(VIA));
		const pairs = [];
		const why = Object.fromEntries(RULES.map((r) => [r, 0]));
		for (const a of candidates) {
			const at = utcMs(a.created_at);
			const checks = {
				receivable: (i) => i.receivable_id === a.receivable_id,
				tenant: (i) => i.from_tenant === a.tenant_id,
				kind: (i) => flow.inviteMatches(i),
				answerer: (i) => String(a.statement).includes(flow.by + i.accepted_by),
				// No insert stamp means no time proof: NaN fails every comparison (fail closed).
				window: (i) => { const acc = utcMs(i.accepted_at); return at >= acc - BEFORE_MS && at <= acc + AFTER_MS; },
				day: (i) => day(a.attested_at) === day(i.accepted_at) || day(a.attested_at) === day(a.created_at),
			};
			let left = answered;
			for (const rule of RULES) {
				left = left.filter(checks[rule]);
				if (!left.length) { why[rule] += 1; break; }
			}
			for (const i of left) pairs.push({ att: a.id, inv: i.token });
		}
		const perAtt = new Map(); const perInv = new Map();
		for (const p of pairs) {
			perAtt.set(p.att, (perAtt.get(p.att) ?? 0) + 1);
			perInv.set(p.inv, (perInv.get(p.inv) ?? 0) + 1);
		}
		const provable = pairs.filter((p) => perAtt.get(p.att) === 1 && perInv.get(p.inv) === 1).map((p) => p.att);
		for (const id of provable) tags.push({ id, source: flow.source });
		counts[flow.source] = {
			candidates: candidates.length,
			provable: provable.length,
			ambiguous: perAtt.size - provable.length,
			unmatched: candidates.length - perAtt.size,
			why,
		};
	}
	return { tags, counts };
}
