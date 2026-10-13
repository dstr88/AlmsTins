/**
 * walletIdentity.ts: what each wallet key is called, whose it is, and what kind of account it is.
 *
 * Labels and owner labels live in wallet_identity (tenant_id, wallet_key, label, owner_label,
 * updated_at), unique on (tenant_id, wallet_key), keyed by the string from walletKey.ts rather
 * than by wallets.id: a wallet deleted and re-added gets a new id, and an exchange account's
 * cex: mirror wallet row only appears after a background snapshot. Created at runtime by
 * ensureWalletIdentityTable() (no migration runner; migrations-pg/0049_wallet_identity.sql is
 * the mirror). The owner label ("Whose account is this?") is written by walletOwnerLabel.ts;
 * the label column is not written yet, so names come from wallets.label and the account name.
 *
 * Defaults when nothing is set:
 *   on-chain wallet   wallets.label (which defaults to the last 5 characters of the address),
 *                     plus the chain: "a1b2c · Ethereum"
 *   exchange account  the source and the account's own name: "Crypto.com · Account #2", or
 *                     just "Coinbase" when the account is named after its exchange
 *   no account        "Crypto.com (unassigned)"
 *   owner             not set ("Owner not set" in the files)
 *
 * Owner of an on-chain wallet: the owner label saved on its own key, or else the one saved on
 * any other key of the same address. One address is one set of keys, so it has one owner, and
 * a chain the wallet starts using after the owner was set still shows that owner.
 *
 * Tenant isolation: every query is scoped by the session's tenant_id, and a wallet or account
 * id that is not in this tenant's own lists resolves as unassigned or removed, never to
 * another tenant's row.
 */

import { db } from './db';
import { importSourceDisplayName, canonicalImportSource } from './importSource';
import { deriveDefaultLabel } from './wallets';
import { cexWalletKey, chainWalletKey, isChainSource, normalizeChain, parseWalletKey } from './walletKey';
import type { HistoryFileStrings } from '@/i18n/historyExport';

export type AccountType = 'onchain' | 'custom' | 'exchange' | 'unassigned';

/** Where a transaction row says it belongs, before it is resolved to a key. */
export type WalletRef =
	/** A row of `wallets`: on-chain EVM, Sui, custom, or a chain-synced import (bitcoin, solana). */
	| { kind: 'wallet'; walletId: string | null; chain: string }
	/** An exchange account; accountId null = the row was imported with no account. */
	| { kind: 'account'; source: string; accountId: string | null };

export interface WalletIdentity {
	key: string;
	/** Display name: the label set in wallet_identity, or the default. Untrusted text. */
	label: string;
	/** Free text the user typed; null when not set. Untrusted text. */
	ownerLabel: string | null;
	accountType: AccountType;
	/** The address for an on-chain wallet, the account's name for an exchange account. */
	addressOrAccount: string;
	/** Normalized chain for a chain key; '' for an exchange account. */
	chain: string;
}

export interface DirectoryWallet {
	id: string;
	address: string;
	label: string | null;
	walletType: string;
}

export interface DirectoryAccount {
	id: string;
	source: string;
	name: string;
}

export interface WalletDirectory {
	wallets: Map<string, DirectoryWallet>;
	/** By address, EVM lowercased (for counterparty lookups). */
	walletsByAddress: Map<string, DirectoryWallet>;
	accounts: Map<string, DirectoryAccount>;
	overrides: Map<string, { label: string | null; ownerLabel: string | null }>;
	/** Owner label by on-chain address (EVM lowercased), from any key of that address. */
	ownersByAddress: Map<string, string>;
}

/** Owner labels that are set, by wallet key and by on-chain address. */
export interface OwnerIndex {
	byKey: Map<string, string>;
	/** Address lookup key → owner label, from the first {chain}:{address} key (sorted) that has one. */
	byAddress: Map<string, string>;
}

// ── Table ────────────────────────────────────────────────────────────────────

const CREATE_WALLET_IDENTITY = `CREATE TABLE IF NOT EXISTS wallet_identity (
	tenant_id   TEXT NOT NULL,
	wallet_key  TEXT NOT NULL,
	label       TEXT,
	owner_label TEXT,
	updated_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
	UNIQUE (tenant_id, wallet_key)
)`;

// Single-flight: concurrent first requests share one run. A run that throws is forgotten, so
// the next call tries again instead of failing until the process restarts.
let ensurePromise: Promise<void> | null = null;

export function ensureWalletIdentityTable(): Promise<void> {
	if (!ensurePromise) {
		const run = (async () => {
			await db.execute({ sql: CREATE_WALLET_IDENTITY, args: [] });
		})();
		ensurePromise = run;
		run.catch(() => {
			if (ensurePromise === run) ensurePromise = null;
		});
	}
	return ensurePromise;
}

// ── Loading (tenant-scoped) ──────────────────────────────────────────────────

const str = (v: unknown): string => (v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => {
	const s = str(v).trim();
	return s ? s : null;
};

/** Address key for lookups: EVM lowercased, everything else as stored, trimmed. */
export function addressLookupKey(address: unknown): string {
	const a = str(address).trim();
	return /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : a;
}

/**
 * Index (wallet_key, owner_label) rows. Pure. Keys are taken in sorted order so the owner shown
 * for an address is the same on every read; the write path gives every key of an address the
 * same owner, so in practice there is one.
 */
export function buildOwnerIndex(rows: Iterable<{ walletKey: string; ownerLabel: string | null }>): OwnerIndex {
	const sorted = [...rows].filter((r) => r.walletKey && r.ownerLabel).sort((a, b) => (a.walletKey < b.walletKey ? -1 : a.walletKey > b.walletKey ? 1 : 0));
	const index: OwnerIndex = { byKey: new Map(), byAddress: new Map() };
	for (const { walletKey, ownerLabel } of sorted) {
		index.byKey.set(walletKey, ownerLabel!);
		const parsed = parseWalletKey(walletKey);
		if (parsed?.kind === 'chain' && parsed.address) {
			const addr = addressLookupKey(parsed.address);
			if (!index.byAddress.has(addr)) index.byAddress.set(addr, ownerLabel!);
		}
	}
	return index;
}

/** The owner shown for a row of `wallets`: an exchange mirror by its account key, anything else by its address. */
export function ownerForWalletAddress(index: OwnerIndex, address: unknown): string | null {
	const a = str(address).trim();
	if (!a) return null;
	if (a.toLowerCase().startsWith('cex:')) {
		const parsed = parseWalletKey(a);
		return parsed?.kind === 'cex' ? (index.byKey.get(cexWalletKey(parsed.source, parsed.accountId)) ?? null) : null;
	}
	return index.byAddress.get(addressLookupKey(a)) ?? null;
}

/** The owner shown for an exchange account (source may be the stored value or the URL slug). */
export function ownerForAccount(index: OwnerIndex, source: unknown, accountId: unknown): string | null {
	return index.byKey.get(cexWalletKey(source, accountId)) ?? null;
}

/** The tenant's owner labels. One query, WHERE tenant_id = ?. */
export async function loadOwnerIndex(tenantId: string): Promise<OwnerIndex> {
	await ensureWalletIdentityTable();
	const res = await db.execute({
		sql: `SELECT wi.wallet_key, wi.owner_label FROM wallet_identity wi WHERE wi.tenant_id = ? AND wi.owner_label IS NOT NULL`,
		args: [tenantId],
	});
	return buildOwnerIndex(
		(res.rows as Record<string, unknown>[]).map((r) => ({ walletKey: str(r.wallet_key).trim(), ownerLabel: strOrNull(r.owner_label) })),
	);
}

/** The tenant's wallets, exchange accounts and saved labels. Three queries, each WHERE tenant_id = ?. */
export async function loadWalletDirectory(tenantId: string): Promise<WalletDirectory> {
	await ensureWalletIdentityTable();
	const [walletRes, accountRes, identityRes] = await Promise.all([
		db.execute({
			sql: `SELECT w.id, w.address, w.label, w.wallet_type FROM wallets w WHERE w.tenant_id = ?`,
			args: [tenantId],
		}),
		db.execute({
			sql: `SELECT ea.id, ea.source, ea.name FROM exchange_accounts ea WHERE ea.tenant_id = ?`,
			args: [tenantId],
		}),
		db.execute({
			sql: `SELECT wi.wallet_key, wi.label, wi.owner_label FROM wallet_identity wi WHERE wi.tenant_id = ?`,
			args: [tenantId],
		}),
	]);

	const dir: WalletDirectory = {
		wallets: new Map(),
		walletsByAddress: new Map(),
		accounts: new Map(),
		overrides: new Map(),
		ownersByAddress: new Map(),
	};
	for (const r of walletRes.rows as Record<string, unknown>[]) {
		const id = str(r.id);
		if (!id) continue;
		const w: DirectoryWallet = {
			id,
			address: str(r.address).trim(),
			label: strOrNull(r.label),
			walletType: str(r.wallet_type) || 'onchain',
		};
		dir.wallets.set(id, w);
		if (w.address) dir.walletsByAddress.set(addressLookupKey(w.address), w);
	}
	for (const r of accountRes.rows as Record<string, unknown>[]) {
		const id = str(r.id);
		if (!id) continue;
		dir.accounts.set(id, { id, source: str(r.source), name: str(r.name).trim() });
	}
	for (const r of identityRes.rows as Record<string, unknown>[]) {
		const key = str(r.wallet_key).trim();
		if (!key) continue;
		dir.overrides.set(key, { label: strOrNull(r.label), ownerLabel: strOrNull(r.owner_label) });
	}
	dir.ownersByAddress = buildOwnerIndex(
		[...dir.overrides].map(([walletKey, o]) => ({ walletKey, ownerLabel: o.ownerLabel })),
	).byAddress;
	return dir;
}

// ── Display names (pure) ─────────────────────────────────────────────────────

const CHAIN_NAMES: Readonly<Record<string, string>> = {
	ethereum: 'Ethereum',
	polygon: 'Polygon',
	avalanche: 'Avalanche',
	bitcoin: 'Bitcoin',
	solana: 'Solana',
	sui: 'Sui',
	rootstock: 'Rootstock',
	litecoin: 'Litecoin',
	tron: 'Tron',
	base: 'Base',
	arbitrum: 'Arbitrum',
	optimism: 'Optimism',
	bsc: 'BNB Chain',
};

export function chainDisplayName(chain: unknown, strings: HistoryFileStrings): string {
	const c = normalizeChain(chain);
	if (c === 'custom') return strings.customChain;
	if (c === 'unknown') return strings.unknownChain;
	return CHAIN_NAMES[c] ?? c.charAt(0).toUpperCase() + c.slice(1);
}

/** 'crypto_com' → 'Crypto.com'; a blockchain source → its chain name ('avalanche_cchain' → 'Avalanche'). */
export function sourceDisplayName(source: unknown, strings: HistoryFileStrings): string {
	const s = canonicalImportSource(source);
	if (isChainSource(s)) return chainDisplayName(s, strings);
	return importSourceDisplayName(s);
}

// ── Resolution (pure) ────────────────────────────────────────────────────────

function withOverride(dir: WalletDirectory, base: Omit<WalletIdentity, 'ownerLabel'>, fallbackOwner: string | null = null): WalletIdentity {
	const o = dir.overrides.get(base.key);
	return { ...base, label: o?.label ?? base.label, ownerLabel: o?.ownerLabel ?? fallbackOwner };
}

// Letters and digits only: "Crypto.com", "crypto com" and "crypto_com" compare equal.
const compactName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** "Crypto.com · Account #2"; just "Coinbase" for an account named after its exchange. */
export function accountDisplayName(sourceName: string, accountName: string): string {
	const name = accountName.trim();
	if (!name || compactName(name) === compactName(sourceName)) return sourceName;
	return `${sourceName} · ${name}`;
}

function resolveAccount(dir: WalletDirectory, source: string, accountId: string | null, strings: HistoryFileStrings): WalletIdentity {
	const key = cexWalletKey(source, accountId);
	const sourceName = sourceDisplayName(source, strings);
	if (!accountId) {
		return withOverride(dir, {
			key,
			label: strings.unassignedName(sourceName),
			accountType: 'unassigned',
			addressOrAccount: '',
			chain: '',
		});
	}
	const type: AccountType = isChainSource(source) ? 'onchain' : 'exchange';
	const account = dir.accounts.get(accountId);
	if (!account) {
		return withOverride(dir, {
			key,
			label: strings.removedAccountName(sourceName),
			accountType: type,
			addressOrAccount: '',
			chain: '',
		});
	}
	return withOverride(dir, {
		key,
		label: accountDisplayName(sourceName, account.name),
		accountType: type,
		addressOrAccount: account.name,
		chain: '',
	});
}

/** Resolve where a row belongs to its wallet key, display name, owner and account type. */
export function resolveWalletRef(dir: WalletDirectory, ref: WalletRef, strings: HistoryFileStrings): WalletIdentity {
	if (ref.kind === 'account') return resolveAccount(dir, ref.source, ref.accountId, strings);

	const chain = normalizeChain(ref.chain);
	const wallet = ref.walletId ? dir.wallets.get(ref.walletId) : undefined;
	if (!wallet) {
		return withOverride(dir, {
			key: chainWalletKey(chain, null),
			label: strings.unassignedName(chainDisplayName(chain, strings)),
			accountType: 'unassigned',
			addressOrAccount: '',
			chain,
		});
	}
	// An exchange mirror wallet (address cex:{source}:{accountId}) is that exchange account.
	if (wallet.address.toLowerCase().startsWith('cex:')) {
		const parsed = parseWalletKey(wallet.address);
		if (parsed?.kind === 'cex') return resolveAccount(dir, parsed.source, parsed.accountId, strings);
	}
	const isCustom = wallet.walletType === 'custom';
	// A custom wallet with no address stores a generated placeholder: not an address to show.
	const shownAddress = isCustom && /^custom_/i.test(wallet.address) ? '' : wallet.address;
	const baseLabel = wallet.label ?? deriveDefaultLabel(wallet.address);
	return withOverride(
		dir,
		{
			key: chainWalletKey(chain, wallet.address),
			label: `${baseLabel} · ${chainDisplayName(chain, strings)}`,
			accountType: isCustom ? 'custom' : 'onchain',
			addressOrAccount: shownAddress,
			chain,
		},
		dir.ownersByAddress.get(addressLookupKey(wallet.address)) ?? null,
	);
}
