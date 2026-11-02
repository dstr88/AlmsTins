/**
 * The "Seen before?" store (S5): the records at Almstins whose invoice key matches a check, read
 * across every account in one SELECT, and handed back as ID-free rows (SeenBeforeRow) for
 * summarizeMatches in ../seenBefore.ts.
 *
 * Server-only. The rules, each pinned by tests/receivables/seenBeforeStore.test.ts:
 *   - fail closed: no key, a fingerprint column not confirmed, or any row still waiting for the
 *     backfill reads "unavailable", which the route answers as 503, never as "not found";
 *   - the invoice key only (fingerprint_inv), under the current kid, test with test and real with
 *     real. The debtor's reference is compared in TS, by string, only on rows the invoice key
 *     matched, so a reference-only twin is never found;
 *   - the SELECT never names tenant_id and returns no ID: a match is the same whoever asks, and
 *     nothing about who recorded it can leave. It runs on the owner pool (runWithoutDbContext),
 *     like every cross-tenant receivables read (see the note above ENCUMBRANCE_SQL in the registry);
 *   - withdrawn records (S2) count, marked withdrawn, like the twin query;
 *   - a debtor dispute is the debtor's own answer through a request link (source debtor_dispute,
 *     or a legacy row with no source in the exact wording confirmByToken writes). A client's
 *     dispute of a receipt or of the record is not a debtor dispute. Without the source column a
 *     confirmation is never read (a NULL source is never consent);
 *   - every string is a bound parameter, and the window is LIMIT 50, financed records first.
 *
 * A thrown error propagates: the route logs one fixed line and answers 503. Nothing here logs, and
 * importing it starts nothing (the backfill is kicked by the route).
 */
import { db } from '@/lib/db';
import { runWithoutDbContext } from '@/lib/dbContext';
import {
	ENCUMBRANCE_SQL,
	agingAwareFinancingOf,
	fingerprintCoverageOk,
	receivableColumnsEnsured,
	receivableDeletedAtReady,
} from '@/lib/receivablesRegistry';
import { RESERVED_STATEMENT_PREFIXES } from '@/lib/receivables/attestationClass';
import { computeFingerprints } from '@/lib/receivables/server/fingerprint';
import { toFingerprintInput, type SeenBeforeInput, type SeenBeforeRow } from '@/lib/receivables/seenBefore';

/** At most this many matching rows are read per check (the twin query's window). */
const SEEN_BEFORE_ROW_LIMIT = 50;

/** The debtor's answers through a request link (confirmByToken), as stored. */
const DEBTOR_CONFIRMATION = { source: 'debtor_confirmation', role: 'buyer' } as const;
const DEBTOR_DISPUTE_SOURCE = 'debtor_dispute';
/** The two openings confirmByToken writes for a debtor dispute, for rows recorded before the
 *  source column existed. A receipt or record dispute opens with other words. */
const LEGACY_DEBTOR_DISPUTE_PATTERNS = [
	`${RESERVED_STATEMENT_PREFIXES[0]} states this invoice is not theirs%`,
	`${RESERVED_STATEMENT_PREFIXES[0]} states the amount is wrong%`,
] as const;

export type SeenBeforeRead =
	| { state: 'ok'; rows: SeenBeforeRow[]; refChecked: boolean }
	| { state: 'unavailable' };

const truthy = (v: unknown): boolean => v === true || v === 1 || v === 'true' || v === 't';

/** The matching records for a parsed check, or "unavailable". Throws on a store error. `now` is
 *  the aging clock for the lapse filter (A3); always the moment of the check except in tests. */
export async function readSeenBefore(input: SeenBeforeInput, now: Date = new Date()): Promise<SeenBeforeRead> {
	if (!(await fingerprintCoverageOk())) return { state: 'unavailable' };
	const fp = computeFingerprints(toFingerprintInput(input));
	if (!fp || fp.inv === null) return { state: 'unavailable' };
	// Valid now: fingerprintCoverageOk awaited the ensure.
	const withSource = receivableColumnsEnsured();
	const withDeleted = receivableDeletedAtReady();

	const legacyDispute = `(${LEGACY_DEBTOR_DISPUTE_PATTERNS.map(() => 'a.statement LIKE ?').join(' OR ')})`;
	const debtorDispute = withSource
		? `a.source = ? OR ((a.source IS NULL OR a.source = ?) AND ${legacyDispute})`
		: legacyDispute;
	const disputeArgs = withSource
		? [DEBTOR_DISPUTE_SOURCE, '', ...LEGACY_DEBTOR_DISPUTE_PATTERNS]
		: [...LEGACY_DEBTOR_DISPUTE_PATTERNS];

	// Every tenant's rows, on the owner pool. r.id and r.due_date close the list: read only for
	// the lapse recompute below, never mapped into a row.
	const r = await runWithoutDbContext(() => db.execute({
		sql: `SELECT r.face, r.created_at, r.settled_at, r.fingerprint_ref${withDeleted ? ', r.deleted_at' : ''},
		             (${ENCUMBRANCE_SQL}) AS encumbered,
		             (SELECT COALESCE(SUM(c.amount), 0) FROM receivable_claims c WHERE c.receivable_id = r.id AND c.status = 'active') AS claimed,
		             (EXISTS (SELECT 1 FROM receivable_claims c WHERE c.receivable_id = r.id AND c.status = 'active' AND c.affirmed_at IS NOT NULL)) AS any_affirmed,
		             (EXISTS (SELECT 1 FROM receivable_claims c WHERE c.receivable_id = r.id AND c.status = 'active' AND c.affirmed_at IS NULL)) AS any_unaffirmed,${withSource ? `
		             (EXISTS (SELECT 1 FROM receivable_attestations a WHERE a.receivable_id = r.id AND a.source = ? AND a.role = ?)) AS debtor_confirmed,` : ''}
		             (EXISTS (SELECT 1 FROM receivable_attestations a WHERE a.receivable_id = r.id AND (${debtorDispute}))) AS debtor_disputed,
		             r.id, r.due_date
		      FROM receivables r
		      WHERE r.fingerprint_kid = ? AND r.is_test = ? AND r.fingerprint_inv = ?
		      ORDER BY (${ENCUMBRANCE_SQL}) DESC, r.created_at ASC, r.id
		      LIMIT ${SEEN_BEFORE_ROW_LIMIT}`,
		args: [
			...(withSource ? [DEBTOR_CONFIRMATION.source, DEBTOR_CONFIRMATION.role] : []),
			...disputeArgs,
			fp.kid, input.isTest, fp.inv,
		],
	}));

	const rows: SeenBeforeRow[] = [];
	for (const row of r.rows as any[]) {
		let claimed = Number(row.claimed);
		let encumbered = truthy(row.encumbered);
		let anyAffirmed = truthy(row.any_affirmed);
		let anyUnaffirmed = truthy(row.any_unaffirmed);
		let anyStale = false;
		let staleSince: string | null = null;
		// The lapse filter (A3): the SQL above counts lapsed claims (D7) because it cannot read
		// the touch chain, so a financed row is re-read in JS and its figures keep only counted
		// claims; the freshness story rides along. Same owner-pool path as the SELECT. Non-fatal
		// per row: on an error (or a driver row with no id, as in the coercion tests) the SQL
		// figures stand — conservative, they can only over-warn, never falsely read clear.
		if (encumbered && row.id != null) {
			try {
				const fin = await runWithoutDbContext(() => agingAwareFinancingOf({
					id: String(row.id),
					due_date: row.due_date != null ? String(row.due_date) : null,
					settled_at: row.settled_at != null ? String(row.settled_at) : null,
				}, now));
				claimed = fin.claimed;
				encumbered = fin.encumbered;
				anyAffirmed = fin.anyAffirmed;
				anyUnaffirmed = fin.anyUnaffirmed;
				anyStale = fin.anyStale;
				staleSince = fin.staleSince;
			} catch { /* keep the SQL figures */ }
		}
		rows.push({
			face: Number(row.face),
			claimed,
			encumbered,
			anyAffirmed,
			anyUnaffirmed,
			anyStale,
			staleSince,
			debtorConfirmed: withSource && truthy(row.debtor_confirmed),
			debtorDisputed: truthy(row.debtor_disputed),
			settled: row.settled_at != null,
			withdrawn: withDeleted && row.deleted_at != null,
			// Compared here, by string, so the hash never leaves this function.
			refMatch: fp.ref !== null && row.fingerprint_ref === fp.ref,
			createdDay: String(row.created_at).slice(0, 10),
		});
	}
	return { state: 'ok', rows, refChecked: fp.ref !== null };
}
