// One-time cleanup for privacy policy v1.2 (2026-10-10). NOT run by db:migrate.
// Run AFTER the deploy that ships the matching code, so old code cannot re-create
// anything this removes.
//
//   node --env-file=.env src/scripts/privacyCleanupV12.mjs           # dry run, read-only
//   node --env-file=.env src/scripts/privacyCleanupV12.mjs --apply   # write
//
// Five sections, each in its own transaction. A section whose counts move between the
// plan and the write rolls back and changes nothing; the others still run. Prints counts
// only, never an address, label, name, email or browser string.
//
//  1. shared_labels   Every saved label used to count as a cross-account vote, and 3
//                     matching votes published a label to every user. Deletes all votes
//                     and the labels voting created (protocol IS NULL), puts back the five
//                     curated Aave labels from src/scripts/seedKnownAddresses.mjs where a
//                     5-vote correction overwrote one, and re-adds any that are missing.
//                     Fails closed: without a protocol column nothing but the votes goes.
//  2. legacy_profiles Nulls the personal columns an old profile form saved in `users`
//                     (name, mailing address, phone, second email). Rows stay.
//  3. roster_caches   Re-seals plain-JSON roster caches (the decrypted address list) to
//                     the published roster key, in the format sealRosterCache writes.
//                     Skipped if the key cannot be fetched or does not match its id.
//  4. request_log     Drops the wallet address older rows kept (wallet_address, and the
//                     /wallet/<address> path in route).
//  5. demo_sessions   Drops raw browser strings and the query/fragment of referrers.
import pg from 'pg';
import { publishedRosterKey, sealRoster } from './rosterSeal.mjs';

const APPLY = process.argv.includes('--apply');
const KEY_URL = 'https://almstins.com/.well-known/almstins-verify-encryption-key.json';

// The curated labels, exactly as src/scripts/seedKnownAddresses.mjs seeds them.
const CURATED = [
	['0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', 'Aave V3 Pool · Ethereum', 'defi', 'ethereum', 'aave'],
	['0xd01607c3c5ecaba394d8be377a08590149325722', 'Aave V3 WETH Gateway · Ethereum', 'defi', 'ethereum', 'aave'],
	['0x794a61358d6845594f94dc1db02a252b5b4814ad', 'Aave V3 Pool · Polygon / Avalanche', 'defi', 'polygon', 'aave'],
	['0xbc302053db3aa514a3c86b9221082f162b91ad63', 'Aave V3 WMATIC Gateway · Polygon', 'defi', 'polygon', 'aave'],
	['0x2825ce5921538d17cc15ae00a8b24ff759c6cdae', 'Aave V3 WAVAX Gateway · Avalanche', 'defi', 'avalanche', 'aave'],
];

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const columnsOf = async (table) => new Set((await c.query(
	`select column_name from information_schema.columns where table_schema = current_schema() and table_name = $1`, [table],
)).rows.map((r) => r.column_name));
const n = async (sql, args = []) => (await c.query(sql, args)).rows[0].n;

let failed = false;

/** Plan → print → (apply in one transaction, each step's rowCount must equal its plan). */
async function section(name, steps, note = '') {
	const summary = steps.map((s) => `${s.label}=${s.planned}`).join(' ');
	console.log(`${name}: ${summary || '(nothing)'}${note ? ` ${note}` : ''}`);
	if (!APPLY || !steps.some((s) => s.planned > 0)) return;
	await c.query('BEGIN');
	try {
		for (const s of steps) {
			const done = await s.run();
			if (done !== s.planned) throw new Error(`${s.label}: changed ${done}, planned ${s.planned}`);
		}
		await c.query('COMMIT');
		console.log(`${name}: applied`);
	} catch (e) {
		await c.query('ROLLBACK');
		failed = true;
		console.log(`${name}: ROLLED BACK, nothing changed: ${e.message}`);
	}
}

console.log(APPLY ? 'APPLY' : 'DRY RUN (read-only)');

// ── 1. shared_labels ────────────────────────────────────────────────────────
{
	const gal = await columnsOf('global_address_labels');
	const votesExist = (await columnsOf('global_address_label_votes')).size > 0;
	const steps = [];
	if (votesExist) {
		steps.push({ label: 'votes', planned: await n(`select count(*)::int n from global_address_label_votes`),
			run: async () => (await c.query(`delete from global_address_label_votes`)).rowCount });
	}
	let note = '';
	if (gal.has('protocol')) {
		steps.push({ label: 'vote_made_labels', planned: await n(`select count(*)::int n from global_address_labels where protocol is null`),
			run: async () => (await c.query(`delete from global_address_labels where protocol is null`)).rowCount });
		let relabel = 0;
		for (const [address, label] of CURATED) {
			relabel += await n(`select count(*)::int n from global_address_labels where address = $1 and protocol is not null and label <> $2`, [address, label]);
		}
		steps.push({ label: 'curated_restored', planned: relabel, run: async () => {
			let done = 0;
			for (const [address, label] of CURATED) {
				done += (await c.query(`update global_address_labels set label = $2, vote_count = 0 where address = $1 and protocol is not null and label <> $2`, [address, label])).rowCount;
			}
			return done;
		} });
		if (gal.has('category') && gal.has('chain')) {
			// Missing once the vote-made rows above are gone: absent now, or present without a protocol.
			let missing = 0;
			for (const [address] of CURATED) {
				missing += await n(`select (count(*) filter (where protocol is not null) = 0)::int n from global_address_labels where address = $1`, [address]);
			}
			steps.push({ label: 'curated_readded', planned: missing, run: async () => {
				let done = 0;
				for (const [address, label, category, chain, protocol] of CURATED) {
					done += (await c.query(
						`insert into global_address_labels (address, label, vote_count, category, chain, protocol)
						 values ($1, $2, 0, $3, $4, $5) on conflict (address) do nothing`,
						[address, label, category, chain, protocol])).rowCount;
				}
				return done;
			} });
		}
	} else if (gal.size > 0) {
		note = '(no protocol column: shared and curated labels cannot be told apart, so only votes are deleted; ask before removing labels)';
	}
	await section('shared_labels', steps, note);
}

// ── 2. legacy_profiles ──────────────────────────────────────────────────────
{
	const present = await columnsOf('users');
	const cols = ['full_name', 'street_address', 'city', 'state', 'postal_code', 'country', 'phone_number', 'secondary_email']
		.filter((col) => present.has(col));
	const steps = [];
	for (const col of cols) {
		steps.push({ label: col, planned: await n(`select count(*)::int n from users where ${col} is not null`),
			run: async () => (await c.query(`update users set ${col} = null where ${col} is not null`)).rowCount });
	}
	await section('legacy_profiles', steps);
}

// ── 3. roster_caches ────────────────────────────────────────────────────────
{
	const PLAIN = `roster_cache_json is not null and left(ltrim(roster_cache_json), 1) = '['`;
	const proofs = await columnsOf('verify_domain_proofs');
	if (!proofs.has('roster_cache_json')) {
		console.log('roster_caches: (no roster cache column)');
	} else {
		const rows = (await c.query(`select id, roster_cache_json from verify_domain_proofs where ${PLAIN}`)).rows;
		const sealedCount = await n(`select count(*)::int n from verify_domain_proofs where roster_cache_json is not null and left(ltrim(roster_cache_json), 1) = '{'`);
		let key = null;
		let note = `(already sealed=${sealedCount})`;
		if (rows.length) {
			try {
				key = await publishedRosterKey(KEY_URL);
			} catch (e) {
				note += ` SKIPPED: ${e.message}`;
				failed = true;
			}
		}
		const steps = key ? [{ label: 'plain_resealed', planned: rows.length, run: async () => {
			let done = 0;
			for (const r of rows) {
				const entries = parseEntries(r.roster_cache_json);
				if (!entries) throw new Error('a plain cache did not parse');
				const sealed = JSON.stringify(await sealRoster(JSON.stringify(entries), key));
				done += (await c.query(
					`update verify_domain_proofs set roster_cache_json = $1 where id = $2 and roster_cache_json = $3`,
					[sealed, r.id, r.roster_cache_json])).rowCount;
			}
			return done;
		} }] : [{ label: 'plain', planned: rows.length, run: async () => 0 }];
		if (key) await section('roster_caches', steps, note);
		else console.log(`roster_caches: plain=${rows.length} ${note}`);
	}
}

// ── 4. request_log ──────────────────────────────────────────────────────────
{
	const cols = await columnsOf('request_log');
	if (cols.has('wallet_address') && cols.has('route_key')) {
		const where = `wallet_address is not null or route_key = '/wallet/:address'`;
		await section('request_log', [{ label: 'rows_with_address', planned: await n(`select count(*)::int n from request_log where ${where}`),
			run: async () => (await c.query(`update request_log set wallet_address = null, route = route_key where ${where}`)).rowCount }]);
	} else {
		console.log('request_log: (no wallet_address column)');
	}
}

// ── 5. demo_sessions ────────────────────────────────────────────────────────
{
	const cols = await columnsOf('demo_sessions');
	const steps = [];
	if (cols.has('user_agent')) {
		// New rows hold a 64-hex salted hash; anything else is a raw browser string.
		const raw = `user_agent is not null and user_agent !~ '^[0-9a-f]{64}$'`;
		steps.push({ label: 'raw_user_agents', planned: await n(`select count(*)::int n from demo_sessions where ${raw}`),
			run: async () => (await c.query(`update demo_sessions set user_agent = null where ${raw}`)).rowCount });
	}
	if (cols.has('referrer')) {
		steps.push({ label: 'referrers_with_query', planned: await n(`select count(*)::int n from demo_sessions where referrer ~ '[?#]'`),
			run: async () => (await c.query(`update demo_sessions set referrer = split_part(split_part(referrer, '?', 1), '#', 1) where referrer ~ '[?#]'`)).rowCount });
	}
	await section('demo_sessions', steps);
}

await c.end();
process.exit(failed ? 1 : 0);

// ── helpers ─────────────────────────────────────────────────────────────────
function parseEntries(stored) {
	try {
		const parsed = JSON.parse(stored);
		if (!Array.isArray(parsed)) return null;
		return parsed.filter((e) => e && typeof e.address === 'string')
			.map((e) => ({ address: e.address, label: typeof e.label === 'string' ? e.label : null }));
	} catch {
		return null;
	}
}
