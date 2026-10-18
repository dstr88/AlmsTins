/**
 * walletOwnerLabel.ts: saving and clearing the owner label ("Whose account is this?") of a
 * wallet or exchange account, in wallet_identity (see walletIdentity.ts for the reads).
 *
 * Every exchange account is its own wallet with its own owner label (owner decision, Oct 12
 * 2026): two Crypto.com accounts, one per person, are two keys, cex:crypto_com:{id1} and
 * cex:crypto_com:{id2}.
 *
 * An on-chain wallet is one row of `wallets` but one key per chain ({chain}:{address}), so the
 * user sets the owner once and it is written to every key of that wallet. The chain list is
 * the union of:
 *   1. the chains configured on the wallet (wallets.chains);
 *   2. the chains of its on-chain rows (transactions.chain WHERE wallet_id);
 *   3. the chains of its chain-synced imports (import_transactions.source WHERE wallet_id,
 *      blockchain sources only: bitcoin, solana, avalanche_cchain, litecoin);
 *   4. sui, when it has Sui rows (sui_transactions WHERE wallet_id);
 *   5. every key already saved for the same address (so clearing reaches all of them);
 * which is every key the history export can resolve that wallet's rows to. A wallet with none
 * of these gets one key from the shape of its address. A chain the wallet starts using later
 * still shows the owner, because the export also reads the owner from any key of the address.
 * An exchange mirror row of `wallets` (address cex:{source}:{accountId}) is that account's key.
 *
 * The owner label is free text the user types: untrusted. It is trimmed, control and
 * direction-override characters become spaces, it is at most OWNER_LABEL_MAX characters, and
 * an empty value clears it. It is escaped wherever it is shown, and it never leaves Almstins.
 *
 * Tenant isolation: every statement is scoped by the session's tenant_id, and the upsert's
 * conflict target is (tenant_id, wallet_key), so no write can reach another tenant's row.
 */

import { db } from './db';
import { DEMO_TENANT_ID } from './demo';
import { getImportTransactionColumns } from './importTransactionsSchema';
import { createFixedWindowLimiter } from './rateLimit';
import { addressLookupKey, ensureWalletIdentityTable } from './walletIdentity';
import { cexWalletKey, chainWalletKey, guessChainFromAddress, isChainSource, normalizeChain, parseWalletKey } from './walletKey';

export const OWNER_LABEL_MAX = 60;

export type OwnerLabelError = 'OWNER_LABEL_INVALID' | 'OWNER_LABEL_TOO_LONG';
export type OwnerLabelParse = { ok: true; value: string | null } | { ok: false; error: OwnerLabelError };

// C0 and C1 controls, line and paragraph separators, and bidirectional overrides/isolates.
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]+/g;

/** Clean the typed owner label. null or '' (after trimming) clears it. */
export function parseOwnerLabel(raw: unknown): OwnerLabelParse {
	if (raw === null || raw === undefined) return { ok: true, value: null };
	if (typeof raw !== 'string') return { ok: false, error: 'OWNER_LABEL_INVALID' };
	const value = raw.normalize('NFC').replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
	if (!value) return { ok: true, value: null };
	if ([...value].length > OWNER_LABEL_MAX) return { ok: false, error: 'OWNER_LABEL_TOO_LONG' };
	return { ok: true, value };
}

// Owner-label writes per account per minute: a person editing labels never gets near it; a
// script looping on the route does.
const OWNER_WRITES_PER_MINUTE = 60;
const writeLimiter = createFixedWindowLimiter({ windowMs: 60_000, max: OWNER_WRITES_PER_MINUTE });

/** Count one owner-label write for the tenant. False when the tenant is over the limit. */
export function ownerLabelWriteAllowed(tenantId: string, now?: number): boolean {
	return !writeLimiter.hit(`t:${tenantId}`, now);
}

/** Tests only. */
export function resetOwnerLabelLimiter(): void {
	writeLimiter.reset();
}

/**
 * The demo is one tenant shared by every visitor, so an owner label typed there would show to
 * all of them. The middleware already refuses these writes for a demo session
 * (src/middleware/demoMutations.ts); the routes refuse them again here.
 */
export function ownerLabelDemoBlocked(tenantId: string): boolean {
	return tenantId === DEMO_TENANT_ID;
}

/** The answer to a demo visitor who sends an owner label: the middleware's demo 403. */
export function ownerLabelDemoResponse(): Response {
	return new Response(JSON.stringify({ ok: false, error: 'Sign up free to unlock all features.', demo: true }), {
		status: 403,
		headers: { 'Content-Type': 'application/json' },
	});
}

// ── Keys (pure) ──────────────────────────────────────────────────────────────

/** wallets.chains as stored: a JSON array (text or already parsed). Anything else is no chains. */
export function parseChainList(value: unknown): string[] {
	let v = value;
	if (typeof v === 'string') {
		try {
			v = JSON.parse(v);
		} catch {
			return [];
		}
	}
	return Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string' && c.trim() !== '') : [];
}

// guessChainFromAddress lives in walletKey.ts (the tax code needs it without this module's database import).
export { guessChainFromAddress };

const isCexAddress = (address: string) => address.trim().toLowerCase().startsWith('cex:');

/**
 * Every key of one row of `wallets`, given its chains. An exchange mirror row is its account's
 * key. Sorted, no duplicates.
 */
export function walletKeysFromChains(address: string, chains: Iterable<unknown>): string[] {
	const a = String(address ?? '').trim();
	if (!a) return [];
	if (isCexAddress(a)) {
		const parsed = parseWalletKey(a);
		return parsed?.kind === 'cex' && parsed.accountId ? [cexWalletKey(parsed.source, parsed.accountId)] : [];
	}
	const keys = new Set<string>();
	for (const c of chains) {
		const chain = normalizeChain(c);
		if (chain !== 'unknown') keys.add(chainWalletKey(chain, a));
	}
	if (!keys.size) keys.add(chainWalletKey(guessChainFromAddress(a), a));
	return [...keys].sort();
}

// ── Loading (tenant-scoped) ──────────────────────────────────────────────────

type DbRow = Record<string, unknown>;
const rowsOf = (res: { rows: unknown[] }) => res.rows as DbRow[];
const noRows = { rows: [] as unknown[] };

/**
 * The chains a wallet has rows on: on-chain rows, chain-synced imports and Sui. Each query is
 * WHERE tenant_id = ? AND wallet_id = ?; one that fails (a table this database does not have)
 * adds nothing rather than failing the save.
 */
export async function walletActivityChains(tenantId: string, walletId: string): Promise<string[]> {
	const columns = await getImportTransactionColumns().catch(() => new Set<string>());
	const [onchain, imported, sui] = await Promise.all([
		db
			.execute({ sql: `SELECT DISTINCT t.chain FROM transactions t WHERE t.tenant_id = ? AND t.wallet_id = ?`, args: [tenantId, walletId] })
			.catch(() => noRows),
		columns.has('wallet_id')
			? db
					.execute({
						sql: `SELECT DISTINCT it.source FROM import_transactions it WHERE it.tenant_id = ? AND it.wallet_id = ?`,
						args: [tenantId, walletId],
					})
					.catch(() => noRows)
			: Promise.resolve(noRows),
		db
			.execute({ sql: `SELECT 1 AS n FROM sui_transactions s WHERE s.tenant_id = ? AND s.wallet_id = ? LIMIT 1`, args: [tenantId, walletId] })
			.catch(() => noRows),
	]);
	const chains: string[] = [];
	for (const r of rowsOf(onchain)) if (r.chain != null) chains.push(String(r.chain));
	for (const r of rowsOf(imported)) if (isChainSource(r.source)) chains.push(String(r.source));
	if (rowsOf(sui).length) chains.push('sui');
	return chains;
}

/** The keys already saved for an on-chain address in this tenant (any chain). */
async function savedKeysForAddress(tenantId: string, address: string): Promise<string[]> {
	const target = addressLookupKey(address);
	const res = await db.execute({
		sql: `SELECT wi.wallet_key FROM wallet_identity wi WHERE wi.tenant_id = ?`,
		args: [tenantId],
	});
	const out: string[] = [];
	for (const r of rowsOf(res)) {
		const key = String(r.wallet_key ?? '').trim();
		const parsed = parseWalletKey(key);
		if (parsed?.kind === 'chain' && parsed.address && addressLookupKey(parsed.address) === target) out.push(key);
	}
	return out;
}

export interface WalletForKeys {
	id: string;
	address: string;
	/** wallets.chains as stored. */
	chains?: unknown;
}

/** Every key of a row of `wallets` (see the header for how the chain list is built). */
export async function walletKeysForWallet(tenantId: string, wallet: WalletForKeys): Promise<string[]> {
	if (isCexAddress(wallet.address)) return walletKeysFromChains(wallet.address, []);
	const chains = [...parseChainList(wallet.chains), ...(await walletActivityChains(tenantId, wallet.id))];
	return walletKeysFromChains(wallet.address, chains);
}

// ── Writing (tenant-scoped) ──────────────────────────────────────────────────

// The same text form as the table's default.
const NOW_SQL = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/**
 * Set (or, with null, clear) the owner label on these keys, in one transaction. A cleared key
 * that has no label either is removed, so nothing is kept that says nothing.
 */
export async function writeOwnerLabel(tenantId: string, keys: readonly string[], ownerLabel: string | null): Promise<void> {
	const list = [...new Set(keys.map((k) => String(k ?? '').trim()).filter(Boolean))];
	if (!tenantId || !list.length) return;
	await ensureWalletIdentityTable();
	const marks = list.map(() => '?').join(', ');
	if (ownerLabel === null) {
		await db.batch(
			[
				{
					sql: `UPDATE wallet_identity SET owner_label = NULL, updated_at = ${NOW_SQL} WHERE tenant_id = ? AND wallet_key IN (${marks})`,
					args: [tenantId, ...list],
				},
				{
					sql: `DELETE FROM wallet_identity WHERE tenant_id = ? AND wallet_key IN (${marks}) AND label IS NULL AND owner_label IS NULL`,
					args: [tenantId, ...list],
				},
			],
			'write',
		);
		return;
	}
	await db.batch(
		list.map((key) => ({
			sql: `INSERT INTO wallet_identity (tenant_id, wallet_key, owner_label, updated_at) VALUES (?, ?, ?, ${NOW_SQL})
			      ON CONFLICT (tenant_id, wallet_key) DO UPDATE SET owner_label = excluded.owner_label, updated_at = excluded.updated_at`,
			args: [tenantId, key, ownerLabel],
		})),
		'write',
	);
}

/** Set or clear the owner of a row of `wallets`, on every key it has. Returns the keys written. */
export async function writeWalletOwnerLabel(tenantId: string, wallet: WalletForKeys, ownerLabel: string | null): Promise<string[]> {
	const keys = new Set(await walletKeysForWallet(tenantId, wallet));
	if (!isCexAddress(wallet.address)) {
		await ensureWalletIdentityTable();
		for (const k of await savedKeysForAddress(tenantId, wallet.address)) keys.add(k);
	}
	const list = [...keys].sort();
	await writeOwnerLabel(tenantId, list, ownerLabel);
	return list;
}

/** Set or clear the owner of an exchange account (source: the stored value or the URL slug). */
export async function writeAccountOwnerLabel(tenantId: string, source: string, accountId: string, ownerLabel: string | null): Promise<string> {
	const key = cexWalletKey(source, accountId);
	await writeOwnerLabel(tenantId, [key], ownerLabel);
	return key;
}

// ── Deleting (tenant-scoped) ─────────────────────────────────────────────────

/**
 * After an exchange account is deleted: remove its wallet_identity row. Its key holds a random
 * account id that is never used again, so the row could only ever be dead weight.
 */
export async function removeAccountIdentity(tenantId: string, source: string, accountId: string): Promise<void> {
	if (!tenantId || !accountId) return;
	await ensureWalletIdentityTable();
	await db.execute({
		sql: `DELETE FROM wallet_identity WHERE tenant_id = ? AND wallet_key = ?`,
		args: [tenantId, cexWalletKey(source, accountId)],
	});
}

/**
 * After a row of `wallets` is deleted: remove the keys of its address, unless another wallet of
 * this tenant still has that address. An exchange mirror row is skipped: its key belongs to the
 * exchange account, which still exists.
 */
export async function removeWalletIdentity(tenantId: string, address: string): Promise<void> {
	if (!tenantId || !String(address ?? '').trim() || isCexAddress(address)) return;
	await ensureWalletIdentityTable();
	const target = addressLookupKey(address);
	const remaining = await db.execute({ sql: `SELECT w.address FROM wallets w WHERE w.tenant_id = ?`, args: [tenantId] });
	if (rowsOf(remaining).some((r) => addressLookupKey(r.address) === target)) return;
	const keys = await savedKeysForAddress(tenantId, address);
	if (!keys.length) return;
	await db.execute({
		sql: `DELETE FROM wallet_identity WHERE tenant_id = ? AND wallet_key IN (${keys.map(() => '?').join(', ')})`,
		args: [tenantId, ...keys],
	});
}
