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
const BEFORE_MS = 60_000;        // clock slack: the attestation may carry a slightly earlier stamp
const AFTER_MS = 10 * 60_000;    // the link is claimed first, then the attestation is written

/** "2026-09-05 14:03:11", "2026-09-05T14:03:11Z" or "...T14:03:11.123Z" as UTC milliseconds. */
export function utcMs(s) {
	if (!s) return NaN;
	const v = String(s).trim().replace(' ', 'T');
	return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + 'Z');
}

/**
 * Which NULL-source attestations provably came through a request link, and as which source.
 * attestations: { id, receivable_id, tenant_id, role, statement, attested_at, source }
 * invites:      { token, receivable_id, from_tenant, role, accepted_at, accepted_by, claim_id, offer_id }
 * Returns { tags: [{ id, source }], counts: { [source]: { candidates, provable, ambiguous, unmatched } } }.
 */
export function matchAttestationSources(attestations, invites) {
	const counts = {};
	const tags = [];
	for (const flow of CONSENT_FLOWS) {
		const candidates = attestations.filter((a) =>
			a.source == null && a.role === flow.role &&
			String(a.statement).startsWith(flow.opening) && String(a.statement).includes(VIA));
		const pairs = [];
		for (const a of candidates) {
			const at = utcMs(a.attested_at);
			for (const i of invites) {
				if (!i.accepted_at || !i.accepted_by) continue;
				if (i.receivable_id !== a.receivable_id || i.from_tenant !== a.tenant_id) continue;
				if (!flow.inviteMatches(i)) continue;
				if (!String(a.statement).includes(flow.by + i.accepted_by)) continue;
				const acc = utcMs(i.accepted_at);
				if (!(at >= acc - BEFORE_MS && at <= acc + AFTER_MS)) continue;
				pairs.push({ att: a.id, inv: i.token });
			}
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
		};
	}
	return { tags, counts };
}
