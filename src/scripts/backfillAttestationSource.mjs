// One-time, hand-run backfill for receivables phase 1 (prerequisite of S1). NOT run by db:migrate.
//
//   node --env-file=.env src/scripts/backfillAttestationSource.mjs           # dry run, read-only
//   node --env-file=.env src/scripts/backfillAttestationSource.mjs --apply   # write
//
// Since S0a (PR #180) an attestation counts as CONSENT only when its recorded `source` says
// so; a row with a NULL source never does (src/lib/receivables/attestationClass.ts). Answers
// given through single-use request links before S0a were written without a source, so a
// debtor's confirmation, a client's receipt or record confirmation, or an accepted offer from
// before then now reads as a plain party statement.
//
// This restores the source ONLY where the database proves the row came through a request
// link. All of these must hold, or the row is left alone:
//   - source IS NULL, the role and the opening words are exactly what that flow writes
//     ("Confirms invoice", "Confirms receipt of", "Confirms this is their receivable:",
//     "Accepts financing of"), and the statement says "via a single-use link";
//   - exactly one answered request link (receivable_invites) for the same receivable, sent by
//     the same tenant, of the matching kind, whose recorded answerer appears in the statement
//     ("Answered by <name>" / "Accepted by <name>"), with the database's insert stamp on the
//     row (created_at) no more than 2 minutes after the link was answered and no more than
//     60s before it (clock slack between the app and the database). attested_at holds only a
//     date, so it must be the day of the answer or of the insert;
//   - and that link matches no other candidate row, and could not have written any other
//     link-worded row either (a dispute, a decline, or a row that already has a source).
// Disputes and system notes are not touched: their opening words already classify them.
//
// `source` is not part of the signed manifest, so Verify now and every signature still check.
// Prints counts only. One transaction; rolls back if any update does not change exactly one row.
import pg from 'pg';
import { matchAttestationSources } from './attestationSourceMatch.mjs';

const APPLY = process.argv.includes('--apply');

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const cols = async (table) => new Set((await c.query(
	`select column_name from information_schema.columns where table_schema = current_schema() and table_name = $1`, [table],
)).rows.map((r) => r.column_name));
const attCols = await cols('receivable_attestations');
const invCols = await cols('receivable_invites');
if (!attCols.has('source')) {
	console.log('receivable_attestations has no source column (S0a not deployed?): nothing to do');
	await c.end();
	process.exit(0);
}
if (!attCols.has('created_at')) {
	console.log('receivable_attestations has no created_at column, so no answer can be timed: nothing to do');
	await c.end();
	process.exit(0);
}

// Only the rows that could qualify, then the matching itself in plain code
// (src/scripts/attestationSourceMatch.mjs, unit-tested).
const attestations = (await c.query(
	`SELECT id, receivable_id, tenant_id, role, statement, attested_at, created_at, source
	   FROM receivable_attestations
	  WHERE statement LIKE '% via a single-use link%'`)).rows;
// Rows cut at the 600-character limit before the link wording are invisible to the match.
const clipped = Number((await c.query(
	`SELECT count(*) AS n FROM receivable_attestations
	  WHERE source IS NULL AND length(statement) >= 600 AND statement NOT LIKE '% via a single-use link%'`)).rows[0].n);
const invites = (await c.query(
	`SELECT token, receivable_id, from_tenant, role, accepted_at, accepted_by,
	        ${invCols.has('claim_id') ? 'claim_id' : 'NULL AS claim_id'},
	        ${invCols.has('offer_id') ? 'offer_id' : 'NULL AS offer_id'}
	   FROM receivable_invites
	  WHERE accepted_at IS NOT NULL AND accepted_by IS NOT NULL`)).rows;
const { tags, counts } = matchAttestationSources(attestations, invites);
// For unmatched rows, the first rule that left no link (counts only, nothing identifying).
const whyText = (why) => {
	const hit = Object.entries(why).filter(([, n]) => n > 0).map(([rule, n]) => `${rule}=${n}`);
	return hit.length ? ` (first failed: ${hit.join(' ')})` : '';
};
const lines = Object.entries(counts).map(([src, n]) =>
	`${src}: candidates=${n.candidates} provable=${n.provable} ambiguous=${n.ambiguous} unmatched=${n.unmatched}${whyText(n.why)}`);
const kindsKnown = invCols.has('claim_id') && invCols.has('offer_id');
if (!kindsKnown) {
	lines.push('note: receivable_invites lacks claim_id or offer_id, so link kinds cannot be told apart: nothing will be tagged');
}
if (clipped > 0) {
	lines.push(`note: ${clipped} row(s) were cut at 600 characters before any link wording; they are left alone`);
}

console.log(APPLY ? 'APPLY' : 'DRY RUN (read-only)');
for (const l of lines) console.log('  ' + l);

let failed = false;
if (APPLY && kindsKnown && tags.length > 0) {
	await c.query('BEGIN');
	try {
		for (const t of tags) {
			const { rowCount } = await c.query(
				`UPDATE receivable_attestations SET source = $1 WHERE id = $2 AND source IS NULL`, [t.source, t.id]);
			if (rowCount !== 1) throw new Error(`${t.source}: a row changed since the plan`);
		}
		await c.query('COMMIT');
		console.log(`applied: ${tags.length} row(s) tagged`);
	} catch (e) {
		await c.query('ROLLBACK');
		failed = true;
		console.log(`ROLLED BACK, nothing changed: ${e.message}`);
	}
} else if (APPLY) {
	console.log('nothing provable to tag');
}

await c.end();
process.exit(failed ? 1 : 0);
