/**
 * lotIdentificationWallets.ts: the wallets and exchange accounts an identification can be recorded
 * for, grouped the way the owner thinks of them. An exchange account is one group with one key. A
 * tracked on-chain address is one group with a key per chain it is used on (the ledger keeps one
 * address on two chains as two wallets), so one choice for the address writes one entry per key.
 *
 * A group is undecided until every one of its keys has at least one entry. Deciding is the owner's
 * click; nothing here ever writes.
 */

import { db } from './db';
import { cexWalletKey } from './walletKey';
import { importSourceDisplayName } from './importSource';
import { loadOwnerIndex, ownerForAccount, ownerForWalletAddress, type OwnerIndex } from './walletIdentity';
import { walletKeysForWallet } from './walletOwnerLabel';
import { isExchangeHeld, type LotIdentification } from './tax/lotIdentification';

export interface WalletGroup {
	/** Stable per group: the exchange account's key, or the on-chain address. */
	id: string;
	kind: 'exchange' | 'onchain';
	/** Untrusted text (the owner's label, an address): the caller escapes it. */
	display: string;
	ownerLabel: string | null;
	/** The wallet keys an entry is recorded for. */
	keys: string[];
	exchangeHeld: boolean;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

const NO_OWNERS: OwnerIndex = { byKey: new Map(), byAddress: new Map() };

/** The tenant's wallets and exchange accounts. Every query is WHERE tenant_id = ?. */
export async function loadWalletGroups(tenantId: string): Promise<WalletGroup[]> {
	const [walletRes, accountRes, owners] = await Promise.all([
		db.execute({ sql: `SELECT id, address, label, chains, wallet_type FROM wallets WHERE tenant_id = ? ORDER BY created_at ASC`, args: [tenantId] }),
		db.execute({ sql: `SELECT id, source, name FROM exchange_accounts WHERE tenant_id = ? ORDER BY source ASC, name ASC`, args: [tenantId] }),
		loadOwnerIndex(tenantId).catch(() => NO_OWNERS),
	]);

	const groups: WalletGroup[] = [];
	const seen = new Set<string>();

	for (const r of accountRes.rows as unknown as Row[]) {
		const id = str(r.id);
		const source = str(r.source);
		if (!id || !source) continue;
		const key = cexWalletKey(source, id);
		if (seen.has(key)) continue;
		seen.add(key);
		const name = str(r.name).trim();
		groups.push({
			id: key,
			kind: 'exchange',
			display: name ? `${importSourceDisplayName(source)} · ${name}` : importSourceDisplayName(source),
			ownerLabel: ownerForAccount(owners, source, id),
			keys: [key],
			exchangeHeld: true,
		});
	}

	for (const r of walletRes.rows as unknown as Row[]) {
		const address = str(r.address).trim();
		if (!address || str(r.wallet_type) === 'custom' || address.startsWith('custom_')) continue;
		const keys = (await walletKeysForWallet(tenantId, { id: str(r.id), address, chains: r.chains })).filter((k) => !seen.has(k));
		if (keys.length === 0) continue;
		for (const k of keys) seen.add(k);
		const label = str(r.label).trim();
		groups.push({
			id: address,
			kind: 'onchain',
			display: label || address,
			ownerLabel: ownerForWalletAddress(owners, address),
			keys,
			exchangeHeld: keys.some(isExchangeHeld),
		});
	}
	return groups;
}

/** Groups with a key no entry names yet. Pure. */
export function undecidedGroups(groups: readonly WalletGroup[], entries: readonly Pick<LotIdentification, 'walletKey'>[]): WalletGroup[] {
	const decided = new Set(entries.map((e) => e.walletKey));
	return groups.filter((g) => g.keys.some((k) => !decided.has(k)));
}
