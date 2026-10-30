/**
 * ledgerContext.ts: what both engines need besides their own rows to tell a transfer from a sale.
 * Every query is scoped by tenant_id, and each one that can fail without hurting the others
 * (a table an older database does not have yet) falls back to nothing: a missing owner label
 * or transfer match only means fewer links and fewer review labels, never a wrong sale.
 */

import { db } from '../db';
import { buildOwnerIndex, loadOwnerIndex, type OwnerIndex } from '../walletIdentity';
import type { WalletEntry } from './walletOfRow';
import type { WalletRecord } from './eventWallet';
import type { ManualBasis } from './lotLedger';
import { normalizeTxHash } from './normalize';
import type { TransferMatchRow } from './transferLinks';

export interface LedgerContext {
	/** The tenant's rows of `wallets`. */
	wallets: WalletRecord[];
	/** The same, by wallets.id. */
	walletsById: Map<string, WalletEntry>;
	/** transactions.wallet_id by normalized tx hash, for the Aave import rows that carry only a hash. */
	walletIdByTxHash: Map<string, string>;
	transferMatches: TransferMatchRow[];
	ownerIndex: OwnerIndex;
	/** The owner's entered bases, by the source id of the sale. */
	manualBasis: Map<string, ManualBasis>;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export async function loadLedgerContext(tenantId: string): Promise<LedgerContext> {
	const walletRes = await db.execute({
		sql: `/* tax:wallets */ SELECT id, address FROM wallets WHERE tenant_id = ?`,
		args: [tenantId],
	});
	const wallets = (walletRes.rows as unknown as Row[]).map((r) => ({ id: r.id, address: r.address }));
	const walletsById = new Map<string, WalletEntry>();
	for (const w of wallets) walletsById.set(str(w.id), { address: str(w.address) });

	const [matches, ownerIndex, manual, hashes] = await Promise.all([
		db
			.execute({
				sql: `/* tax:transfer-matches */ SELECT out_tx_id, in_tx_id, status, confidence_score FROM transfer_matches WHERE tenant_id = ?`,
				args: [tenantId],
			})
			.then((res) =>
				(res.rows as unknown as Row[]).map<TransferMatchRow>((r) => ({
					outId: str(r.out_tx_id),
					inId: str(r.in_tx_id),
					status: str(r.status),
					confidence: typeof r.confidence_score === 'number' ? r.confidence_score : null,
				})),
			)
			.catch(() => [] as TransferMatchRow[]),
		loadOwnerIndex(tenantId).catch(() => buildOwnerIndex([])),
		db
			.execute({
				sql: `/* tax:manual-basis */ SELECT sell_source_id, price_per_token, buy_date_iso, notes FROM manual_cost_basis WHERE tenant_id = ?`,
				args: [tenantId],
			})
			.then((res) => {
				const map = new Map<string, ManualBasis>();
				for (const r of res.rows as unknown as Row[]) {
					const id = str(r.sell_source_id);
					const price = typeof r.price_per_token === 'number' && Number.isFinite(r.price_per_token) ? r.price_per_token : null;
					if (id && price !== null) map.set(id, { pricePerToken: price, buyDateIso: str(r.buy_date_iso), notes: str(r.notes) });
				}
				return map;
			})
			.catch(() => new Map<string, ManualBasis>()),
		db
			.execute({
				sql: `/* tax:aave-wallets */ SELECT t.hash, t.wallet_id
				      FROM transactions t
				      WHERE t.tenant_id = ?
				        AND t.hash IN (SELECT i.tx_hash FROM import_transactions i
				                       WHERE i.tenant_id = ? AND i.source LIKE 'aave%' AND i.tx_hash IS NOT NULL)`,
				args: [tenantId, tenantId],
			})
			.then((res) => {
				const map = new Map<string, string>();
				for (const r of res.rows as unknown as Row[]) {
					const hash = normalizeTxHash(r.hash);
					if (hash && r.wallet_id != null && !map.has(hash)) map.set(hash, str(r.wallet_id));
				}
				return map;
			})
			.catch(() => new Map<string, string>()),
	]);

	return { wallets, walletsById, walletIdByTxHash: hashes, transferMatches: matches, ownerIndex, manualBasis: manual };
}
