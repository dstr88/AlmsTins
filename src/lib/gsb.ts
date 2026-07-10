/**
 * Google Safe Browsing v4 — local mirror via the Update API.
 *
 * Instead of the per-URL Lookup API (quota'd), we download GSB's malicious-URL
 * lists as 4-byte SHA256 hash prefixes and store them locally. A check hashes
 * the URL's expressions locally and looks the prefixes up in Postgres — no
 * network call unless there's a prefix hit, which is then confirmed against
 * Google (fullHashes:find) to eliminate the false positives 4-byte prefixes can
 * cause. Most checks resolve entirely locally.
 *
 * We use FULL updates (empty client state) each refresh, which avoids the
 * removal-by-index diff machinery; each list's checksum is still verified before
 * we trust it. The whole local-lookup path is gated on the canonicalization
 * self-test (see gsbCanon.ts) — if our URL hashing can't reproduce Google's
 * official vectors, we return null (unavailable) rather than a wrong verdict.
 */
import crypto from 'node:crypto';
import { db } from '@/lib/db';
import { generateExpressions, fullHash, hashPrefix, runSelfTest } from '@/lib/gsbCanon';
import { sendMail } from '@/lib/email';

const OWNER_EMAIL = 'donnie@titaniumhut.com';

// Operator alert: a prominent [gsb][ALERT] log line (always) + a one-time owner
// email (deduped per-process so a hot path can't spam). Fire-and-forget — an
// alert failure must never affect a check.
const alerted = new Set<string>();
function alertOwner(key: string, subject: string, body: string): void {
	console.error(`[gsb][ALERT] ${subject} — ${body}`);
	if (alerted.has(key)) return;
	alerted.add(key);
	void sendMail({
		to: OWNER_EMAIL,
		subject: `[Almstins] GSB alert: ${subject}`,
		text: `${body}\n\nThis is a one-time alert per process. Time: ${new Date().toISOString()}`,
	}).catch((e) => console.warn('[gsb] alert email failed:', e instanceof Error ? e.message : e));
}

const GSB_BASE = 'https://safebrowsing.googleapis.com/v4';
const CLIENT = { clientId: 'almstins', clientVersion: '1.0' };
const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'];
const FETCH_TIMEOUT_MS = 30_000;
const INSERT_CHUNK = 1000;
const PREFIX_BYTES = 4;

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
	if (!tableReady) {
		tableReady = db
			.execute({
				sql: `CREATE TABLE IF NOT EXISTS threat_entries (
				        source TEXT NOT NULL,
				        kind   TEXT NOT NULL,
				        value  TEXT NOT NULL,
				        PRIMARY KEY (source, kind, value)
				      )`,
			})
			.then(() => db.execute({ sql: `CREATE INDEX IF NOT EXISTS threat_entries_value_idx ON threat_entries (value)` }))
			.then(() =>
				db.execute({
					sql: `CREATE TABLE IF NOT EXISTS threat_meta (
					        source       TEXT PRIMARY KEY,
					        content_hash TEXT,
					        entry_count  INTEGER NOT NULL DEFAULT 0,
					        refreshed_at TEXT NOT NULL
					      )`,
				}),
			)
			.then(() => {})
			.catch((e) => { tableReady = null; throw e; });
	}
	return tableReady;
}

async function postJson(path: string, key: string, body: unknown): Promise<any> {
	const res = await fetch(`${GSB_BASE}/${path}?key=${encodeURIComponent(key)}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

/** Verify a list's prefixes against Google's checksum: sort the raw 4-byte
 * prefixes lexicographically, concatenate, SHA256, compare to checksum.sha256. */
function checksumOk(prefixHexes: string[], checksumB64: string): boolean {
	const sorted = [...prefixHexes].sort(); // hex sorts identically to fixed-width bytes
	const buf = Buffer.concat(sorted.map((h) => Buffer.from(h, 'hex')));
	const digest = crypto.createHash('sha256').update(buf).digest('base64');
	return digest === checksumB64;
}

function decodeRawHashes(b64: string, prefixSize: number): string[] {
	const buf = Buffer.from(b64, 'base64');
	const out: string[] = [];
	for (let i = 0; i + prefixSize <= buf.length; i += prefixSize) {
		out.push(buf.subarray(i, i + prefixSize).toString('hex'));
	}
	return out;
}

async function replaceGsbPrefixes(prefixes: string[]): Promise<void> {
	const stmts: Array<{ sql: string; args: (string | number)[] }> = [
		{ sql: `DELETE FROM threat_entries WHERE source = 'gsb'`, args: [] },
	];
	const arr = [...prefixes];
	for (let i = 0; i < arr.length; i += INSERT_CHUNK) {
		const chunk = arr.slice(i, i + INSERT_CHUNK);
		const placeholders = chunk.map(() => "('gsb', 'hash_prefix', ?)").join(',');
		stmts.push({ sql: `INSERT INTO threat_entries (source, kind, value) VALUES ${placeholders} ON CONFLICT DO NOTHING`, args: chunk });
	}
	stmts.push({
		sql: `INSERT INTO threat_meta (source, content_hash, entry_count, refreshed_at)
		      VALUES ('gsb', NULL, ?, ?)
		      ON CONFLICT (source) DO UPDATE SET entry_count = excluded.entry_count, refreshed_at = excluded.refreshed_at`,
		args: [arr.length, new Date().toISOString()],
	});
	await db.batch(stmts);
}

export type GsbRefreshResult = { prefixes: number } | { error: string };

/** Full-refresh the local GSB prefix mirror. Never throws. */
export async function refreshGsb(key: string): Promise<GsbRefreshResult> {
	if (!key) return { error: 'no_key' };
	try {
		await ensureTable();
		// Canary: surface a canonicalization regression on every refresh (the cron
		// runs even with no dApp traffic), independent of the per-request check.
		if (!runSelfTest()) {
			alertOwner(
				'selftest',
				'Safe Browsing canonicalization self-test FAILED (refresh canary)',
				'gsbCanon.runSelfTest() did not match Google\'s official vectors during a mirror refresh. Local GSB lookups are disabled until src/lib/gsbCanon.ts is fixed.',
			);
		}
		const body = {
			client: CLIENT,
			listUpdateRequests: THREAT_TYPES.map((threatType) => ({
				threatType,
				platformType: 'ANY_PLATFORM',
				threatEntryType: 'URL',
				state: '', // empty → FULL_UPDATE
				constraints: { supportedCompressions: ['RAW'], maxDatabaseEntries: 500_000 },
			})),
		};
		const data = await postJson('threatListUpdates:fetch', key, body);
		const all = new Set<string>();
		for (const resp of data?.listUpdateResponses ?? []) {
			if (resp.responseType !== 'FULL_UPDATE') continue; // empty state should always yield FULL
			const listPrefixes: string[] = [];
			for (const add of resp.additions ?? []) {
				if (add.compressionType !== 'RAW' || !add.rawHashes?.rawHashes) continue;
				const size = Number(add.rawHashes.prefixSize ?? PREFIX_BYTES);
				for (const p of decodeRawHashes(add.rawHashes.rawHashes, size)) listPrefixes.push(p);
			}
			const csum = resp.checksum?.sha256;
			if (csum && !checksumOk(listPrefixes, csum)) {
				// The prefixes we assembled don't match Google's checksum — a
				// Google-side format/integrity issue (or a decode bug). Skip the
				// list (don't store unverified data) and alert.
				alertOwner(
					`checksum:${resp.threatType}`,
					`Safe Browsing checksum mismatch (${resp.threatType})`,
					`The GSB ${resp.threatType} list failed checksum verification during refresh, so it was NOT stored. This usually means Google changed the Update-API response format or a transient decode issue. If it persists, review src/lib/gsb.ts against the current v4 spec.`,
				);
				continue;
			}
			for (const p of listPrefixes) all.add(p);
		}
		await replaceGsbPrefixes([...all]);
		gsbPopulated = all.size > 0;
		void gsbCanary(key); // behavioral drift check — fire-and-forget
		return { prefixes: all.size };
	} catch (e) {
		console.error('[gsb] refresh failed:', e instanceof Error ? e.message : e);
		return { error: 'refresh_failed' };
	}
}

let gsbPopulated: boolean | null = null;

// Debounced self-heal: refresh the GSB mirror when it's missing or older than
// STALE_MS, without depending on a scheduled cron. Needs the API key.
const GSB_STALE_MS = 6 * 60 * 60 * 1000;
const GSB_DEBOUNCE_MS = 30 * 60 * 1000;
let gsbStaleInFlight = false;
let gsbLastStaleCheck = 0;
export function refreshGsbIfStale(key: string): void {
	if (!key) return;
	const now = Date.now();
	if (gsbStaleInFlight || now - gsbLastStaleCheck < GSB_DEBOUNCE_MS) return;
	gsbStaleInFlight = true;
	gsbLastStaleCheck = now;
	void (async () => {
		try {
			await ensureTable();
			const r = await db.execute({ sql: `SELECT refreshed_at FROM threat_meta WHERE source = 'gsb'` });
			const row = r.rows[0] as { refreshed_at?: string } | undefined;
			const stale = !row?.refreshed_at || Date.now() - Date.parse(row.refreshed_at) > GSB_STALE_MS;
			if (stale) await refreshGsb(key);
			else gsbPopulated = true;
		} catch (e) {
			console.warn('[gsb] stale check failed:', e instanceof Error ? e.message : e);
		} finally {
			gsbStaleInFlight = false;
		}
	})();
}

export type GsbVerdict = { flagged: boolean } | null; // null → unavailable / not ready

/**
 * Local GSB check with confirm-on-match. Returns null when GSB can't be trusted
 * (self-test failing, mirror empty, or an error) so the caller can degrade the
 * source to 'skipped' rather than reporting a wrong verdict.
 */
export async function gsbLookup(rawUrl: string, key: string): Promise<GsbVerdict> {
	if (!runSelfTest()) {
		// Our canonicalization no longer reproduces Google's official vectors — a
		// code regression. Local GSB is disabled (fail-safe); alert so it's fixed.
		alertOwner(
			'selftest',
			'Safe Browsing canonicalization self-test FAILED',
			'gsbCanon.runSelfTest() did not match Google\'s official test vectors, so local GSB lookups are disabled and the checker fell back to the per-call Lookup API. This means the URL-hashing code regressed (see the [gsbCanon] self-test MISMATCH log lines). Fix src/lib/gsbCanon.ts.',
		);
		return null; // canonicalization unverified → do not trust
	}
	try {
		await ensureTable();
		if (gsbPopulated === null) {
			const probe = await db.execute({ sql: `SELECT 1 FROM threat_entries WHERE source = 'gsb' LIMIT 1` });
			gsbPopulated = probe.rows.length > 0;
		}
		if (!gsbPopulated) return null;

		const exprs = generateExpressions(rawUrl);
		const prefixByExpr = exprs.map((e) => ({ prefix: hashPrefix(e, PREFIX_BYTES), full: fullHash(e) }));
		const prefixes = [...new Set(prefixByExpr.map((p) => p.prefix))];
		if (prefixes.length === 0) return { flagged: false };

		const placeholders = prefixes.map(() => '?').join(',');
		const hit = await db.execute({
			sql: `SELECT value FROM threat_entries WHERE source = 'gsb' AND kind = 'hash_prefix' AND value IN (${placeholders})`,
			args: prefixes,
		});
		if (hit.rows.length === 0) return { flagged: false };

		// Prefix hit — confirm against Google to rule out a 4-byte collision.
		if (!key) return { flagged: false }; // can't confirm; treat as clean (prefixes collide often)
		const matchedPrefixes = (hit.rows as unknown as Array<{ value: string }>).map((r) => r.value);
		const confirmed = await confirmFullHashes(matchedPrefixes, key);
		const ourFullHashes = new Set(prefixByExpr.map((p) => p.full));
		const flagged = confirmed.some((fh) => ourFullHashes.has(fh));
		return { flagged };
	} catch (e) {
		console.warn('[gsb] lookup failed:', e instanceof Error ? e.message : e);
		return null;
	}
}

// Google's permanent Safe Browsing test URLs — guaranteed to be in the lists.
// If NONE of these verify against our locally-computed hashes, our
// canonicalization no longer agrees with Google's (i.e. Google changed the
// rules — the drift the static self-test cannot see).
const GSB_TEST_URLS = [
	'https://testsafebrowsing.appspot.com/s/malware.html',
	'https://testsafebrowsing.appspot.com/s/phishing.html',
	'https://testsafebrowsing.appspot.com/s/unwanted.html',
];

/**
 * Behavioral drift canary. For each known-malicious test URL: canonicalize it
 * OUR way, compute prefixes + full hashes, and ask Google (fullHashes:find)
 * whether our prefix is flagged. A verify = one of Google's returned full hashes
 * equals one of OURS. If not a single test URL verifies, alert — Google's
 * canonicalization has diverged from ours (or the test URLs were retired).
 */
async function gsbCanary(key: string): Promise<void> {
	if (!key) return;
	try {
		for (const url of GSB_TEST_URLS) {
			const byExpr = generateExpressions(url).map((e) => ({ prefix: hashPrefix(e, PREFIX_BYTES), full: fullHash(e) }));
			const prefixes = [...new Set(byExpr.map((p) => p.prefix))];
			const returned = await confirmFullHashes(prefixes, key);
			const ours = new Set(byExpr.map((p) => p.full));
			if (returned.some((fh) => ours.has(fh))) return; // verified — canonicalization still matches Google
		}
		alertOwner(
			'canary',
			'Safe Browsing behavioral canary FAILED — Google likely changed URL canonicalization',
			[
				"Google's own permanent test URLs (testsafebrowsing.appspot.com) no longer match the hashes our code computes for them, checked via fullHashes:find.",
				'',
				'What this means: Almstins computes a URL\'s Safe Browsing hash by canonicalizing the URL to Google\'s v4 spec. That behavioral check just failed, which means Google has changed their URL-canonicalization rules (the static self-test cannot detect this, because it only validates our code against our stored copy of Google\'s vectors). Local GSB matching may now produce false negatives until the code is updated. The checker still falls back to the per-call Lookup API, so live checks are not broken.',
				'',
				'How to fix: re-read https://developers.google.com/safe-browsing/v4/urls-hashing , diff the canonicalization rules AND the official test vectors against src/lib/gsbCanon.ts, and update the algorithm + the CANON_VECTORS array to match. Then redeploy.',
				'',
				'Forward this whole email to Claude to make the fix.',
			].join('\n'),
		);
	} catch (e) {
		// A transient API error is not drift — just log, don't alert.
		console.warn('[gsb] canary check errored (not alerting):', e instanceof Error ? e.message : e);
	}
}

/** Ask Google for the full hashes behind matched prefixes; return them as hex. */
async function confirmFullHashes(prefixHexes: string[], key: string): Promise<string[]> {
	try {
		const body = {
			client: CLIENT,
			threatInfo: {
				threatTypes: THREAT_TYPES,
				platformTypes: ['ANY_PLATFORM'],
				threatEntryTypes: ['URL'],
				threatEntries: prefixHexes.map((h) => ({ hash: Buffer.from(h, 'hex').toString('base64') })),
			},
		};
		const data = await postJson('fullHashes:find', key, body);
		const out: string[] = [];
		for (const m of data?.matches ?? []) {
			const b64 = m?.threat?.hash;
			if (b64) out.push(Buffer.from(b64, 'base64').toString('hex'));
		}
		return out;
	} catch (e) {
		console.warn('[gsb] fullHashes confirm failed:', e instanceof Error ? e.message : e);
		return [];
	}
}
