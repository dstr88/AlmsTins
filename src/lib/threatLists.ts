/**
 * Local mirror of the large exact-match phishing blocklists (MetaMask
 * eth-phishing-detect, ScamSniffer) in Postgres.
 *
 * Why DB instead of the in-memory Sets: (1) it survives deploys, so a redeploy
 * doesn't re-download hundreds of thousands of domains from GitHub on every cold
 * start; (2) it keeps ~540K domains out of process RAM; (3) it's the foundation
 * the Google Safe Browsing mirror (millions of hash prefixes — far too big for
 * RAM) drops onto. A check is one indexed point-lookup, and the scan cache sits
 * in front so repeat checks never even reach this table.
 *
 * This is PUBLIC blocklist data (malicious domains) — not user data — so it is
 * global (no tenant scoping) and stored in the clear; that's the whole point.
 *
 * OpenPhish is intentionally NOT mirrored here: its feed is small and its match
 * is a substring test (not exact-domain), which doesn't fit an indexed lookup —
 * it stays in-memory in the checker.
 */
import crypto from 'node:crypto';
import { db } from '@/lib/db';

const METAMASK_URL    = 'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json';
const SCAMSNIFFER_URL = 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json';
const FETCH_TIMEOUT_MS = 45_000;
const STALE_MS         = 6 * 60 * 60 * 1000; // refresh a source once its mirror is older than 6h
const INSERT_CHUNK     = 1000;               // rows per multi-row INSERT (×3 params, well under PG's limit)

let tablesReady: Promise<void> | null = null;
function ensureTables(): Promise<void> {
	if (!tablesReady) {
		tablesReady = db
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
			.catch((e) => {
				tablesReady = null;
				throw e;
			});
	}
	return tablesReady;
}

// Cached "does the mirror have any data?" so a lookup can report warming-up
// cheaply without a COUNT on every check. Set true after a successful load.
let populated: boolean | null = null;

function sha256(s: string): string {
	return crypto.createHash('sha256').update(s).digest('hex');
}

async function fetchText(url: string): Promise<string> {
	const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.text();
}

async function getMeta(source: string): Promise<{ content_hash: string | null; refreshed_at: string | null } | null> {
	const r = await db.execute({ sql: `SELECT content_hash, refreshed_at FROM threat_meta WHERE source = ?`, args: [source] });
	return (r.rows[0] as any) ?? null;
}

/**
 * Replace all rows for a source atomically (DELETE + chunked INSERT + meta
 * upsert in ONE transaction), so a reader never sees a half-loaded list.
 */
async function replaceSource(source: string, entries: Array<{ kind: string; value: string }>, contentHash: string): Promise<void> {
	const stmts: Array<{ sql: string; args: (string | number)[] }> = [
		{ sql: `DELETE FROM threat_entries WHERE source = ?`, args: [source] },
	];
	for (let i = 0; i < entries.length; i += INSERT_CHUNK) {
		const chunk = entries.slice(i, i + INSERT_CHUNK);
		const placeholders = chunk.map(() => '(?, ?, ?)').join(',');
		const args: (string | number)[] = [];
		for (const e of chunk) args.push(source, e.kind, e.value);
		stmts.push({
			sql: `INSERT INTO threat_entries (source, kind, value) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
			args,
		});
	}
	stmts.push({
		sql: `INSERT INTO threat_meta (source, content_hash, entry_count, refreshed_at)
		      VALUES (?, ?, ?, ?)
		      ON CONFLICT (source) DO UPDATE SET
		        content_hash = excluded.content_hash,
		        entry_count  = excluded.entry_count,
		        refreshed_at = excluded.refreshed_at`,
		args: [source, contentHash, entries.length, new Date().toISOString()],
	});
	await db.batch(stmts);
	populated = true;
}

export type ThreatRefreshResult = Record<string, number | 'unchanged' | 'error'>;

/**
 * Fetch each source and reload it ONLY if its content changed since last time
 * (hash-gated), so the expensive 500K-row reload happens at the list's real
 * change cadence, not on every cron tick. Never throws — per-source failures are
 * isolated and reported.
 */
export async function refreshThreatLists(opts?: { force?: boolean }): Promise<ThreatRefreshResult> {
	await ensureTables();
	const out: ThreatRefreshResult = {};

	// MetaMask — { blacklist: string[], whitelist: string[] }
	try {
		const text = await fetchText(METAMASK_URL);
		const hash = sha256(text);
		const meta = await getMeta('metamask');
		if (!opts?.force && meta?.content_hash === hash) {
			out.metamask = 'unchanged';
		} else {
			const cfg = JSON.parse(text);
			const entries: Array<{ kind: string; value: string }> = [];
			for (const d of (cfg.blacklist ?? []) as string[]) entries.push({ kind: 'blacklist', value: String(d).toLowerCase() });
			for (const d of (cfg.whitelist ?? []) as string[]) entries.push({ kind: 'whitelist', value: String(d).toLowerCase() });
			await replaceSource('metamask', entries, hash);
			out.metamask = entries.length;
		}
	} catch (e) {
		console.error('[threatLists] metamask refresh failed:', e instanceof Error ? e.message : e);
		out.metamask = 'error';
	}

	// ScamSniffer — string[] of domains
	try {
		const text = await fetchText(SCAMSNIFFER_URL);
		const hash = sha256(text);
		const meta = await getMeta('scamsniffer');
		if (!opts?.force && meta?.content_hash === hash) {
			out.scamsniffer = 'unchanged';
		} else {
			const arr = JSON.parse(text) as string[];
			const entries = arr.map((d) => ({ kind: 'blacklist', value: String(d).toLowerCase() }));
			await replaceSource('scamsniffer', entries, hash);
			out.scamsniffer = entries.length;
		}
	} catch (e) {
		console.error('[threatLists] scamsniffer refresh failed:', e instanceof Error ? e.message : e);
		out.scamsniffer = 'error';
	}

	return out;
}

// Self-heal: fire-and-forget staleness check, debounced so it runs at most once
// per window regardless of request volume. Keeps the mirror fresh WITHOUT
// depending on an external cron being scheduled — but the cron endpoint can
// still drive it. Persisted meta means a normal redeploy (mirror already fresh)
// does NOT re-download; only a genuinely stale/empty mirror triggers a fetch.
const STALE_CHECK_DEBOUNCE_MS = 30 * 60 * 1000;
let staleCheckInFlight = false;
let lastStaleCheckAt = 0;
export function refreshThreatListsIfStale(): void {
	const now = Date.now();
	if (staleCheckInFlight || now - lastStaleCheckAt < STALE_CHECK_DEBOUNCE_MS) return;
	staleCheckInFlight = true;
	lastStaleCheckAt = now;
	void (async () => {
		try {
			await ensureTables();
			const [mm, ss] = await Promise.all([getMeta('metamask'), getMeta('scamsniffer')]);
			const isStale = (m: { refreshed_at: string | null } | null) =>
				!m?.refreshed_at || Date.now() - Date.parse(m.refreshed_at) > STALE_MS;
			if (isStale(mm) || isStale(ss)) {
				await refreshThreatLists();
			} else {
				populated = true;
			}
		} catch (e) {
			console.warn('[threatLists] stale check failed:', e instanceof Error ? e.message : e);
		} finally {
			staleCheckInFlight = false;
		}
	})();
}

export type DomainThreatLookup = {
	ready: boolean; // false → mirror not populated yet (checker shows "warming up")
	metamaskWhitelist: boolean;
	metamaskBlacklist: boolean;
	scamsniffer: boolean;
};

/** One indexed lookup: which mirrored lists flag this domain. Fail-soft. */
export async function lookupDomainThreats(domain: string): Promise<DomainThreatLookup> {
	const empty: DomainThreatLookup = { ready: false, metamaskWhitelist: false, metamaskBlacklist: false, scamsniffer: false };
	try {
		await ensureTables();
		if (populated === null) {
			const probe = await db.execute({ sql: `SELECT 1 FROM threat_entries LIMIT 1` });
			populated = probe.rows.length > 0;
		}
		if (!populated) return empty;

		const r = await db.execute({
			sql: `SELECT source, kind FROM threat_entries WHERE value = ?`,
			args: [domain.toLowerCase()],
		});
		let mmW = false, mmB = false, ss = false;
		for (const row of r.rows as unknown as Array<{ source: string; kind: string }>) {
			if (row.source === 'metamask' && row.kind === 'whitelist') mmW = true;
			else if (row.source === 'metamask' && row.kind === 'blacklist') mmB = true;
			else if (row.source === 'scamsniffer') ss = true;
		}
		return { ready: true, metamaskWhitelist: mmW, metamaskBlacklist: mmB, scamsniffer: ss };
	} catch (e) {
		console.warn('[threatLists] lookup failed:', e instanceof Error ? e.message : e);
		return empty;
	}
}
