import { db } from '@/lib/db';

// Matches EVM (0x + 40 hex), Bitcoin bech32 (bc1...), legacy BTC (1... 3...),
// and Solana base58 addresses embedded anywhere in a string.
const ADDRESS_RE =
	/\b(0x[a-fA-F0-9]{40}|bc1[a-zA-HJ-NP-Z0-9]{25,}|[13][a-zA-HJ-NP-Z0-9]{25,}|[A-HJ-NP-Za-km-z1-9]{32,44})\b/g;

function extractAddresses(text: string | null): string[] {
	if (!text) return [];
	const matches = text.match(ADDRESS_RE) ?? [];
	// Deduplicate and normalise EVM to lowercase for comparison
	return [...new Set(matches.map(a => (a.startsWith('0x') ? a.toLowerCase() : a)))];
}

/**
 * Scans unclassified OUT transactions for this tenant and auto-sets
 * category = 'own_wallet' when the destination address found in the
 * description or tx_hash matches a wallet or own-wallet address label
 * the user has already registered.
 *
 * Returns the number of transactions newly classified.
 */
export async function autoClassifyOwnWalletTransfers(tenantId: string): Promise<number> {
	// 1. Collect all known own-wallet addresses for this tenant
	const [walletRows, labelRows] = await Promise.all([
		db.execute({
			sql: `SELECT address, label FROM wallets WHERE tenant_id = ?`,
			args: [tenantId],
		}),
		db.execute({
			sql: `SELECT address, label FROM address_labels
			      WHERE tenant_id = ? AND category = 'own_wallet'`,
			args: [tenantId],
		}),
	]);

	// Build a map: normalised_address → label for fast lookup
	const ownAddresses = new Map<string, string>();
	for (const row of walletRows.rows) {
		const addr = String((row as any).address ?? '');
		const label = String((row as any).label ?? addr.slice(0, 8));
		if (addr) ownAddresses.set(addr.toLowerCase(), label);
	}
	for (const row of labelRows.rows) {
		const addr = String((row as any).address ?? '');
		const label = String((row as any).label ?? addr.slice(0, 8));
		if (addr) ownAddresses.set(addr.toLowerCase(), label);
	}

	if (ownAddresses.size === 0) return 0;

	// 2. Fetch all unclassified OUT transactions with a description or tx_hash
	const txRows = await db.execute({
		sql: `SELECT id, description, tx_hash, asset_symbol, amount
		      FROM import_transactions
		      WHERE tenant_id = ?
		        AND direction = 'out'
		        AND (category IS NULL OR category = '')
		        AND (description IS NOT NULL OR tx_hash IS NOT NULL)`,
		args: [tenantId],
	});

	// 3. For each transaction, try to find a matching own-wallet address
	const updates: { id: string; note: string }[] = [];

	for (const row of txRows.rows as any[]) {
		const candidates = [
			...extractAddresses(row.description),
			...extractAddresses(row.tx_hash),
		];

		for (const addr of candidates) {
			const label = ownAddresses.get(addr.toLowerCase());
			if (label) {
				updates.push({
					id: row.id,
					note: `Auto-classified: destination ${addr} matches your wallet "${label}". Non-taxable self-transfer — cost basis carries over.`,
				});
				break; // first match wins
			}
		}
	}

	if (updates.length === 0) return 0;

	// 4. Batch update in chunks of 50
	const CHUNK = 50;
	for (let i = 0; i < updates.length; i += CHUNK) {
		const chunk = updates.slice(i, i + CHUNK);
		await Promise.all(
			chunk.map(({ id, note }) =>
				db.execute({
					sql: `UPDATE import_transactions
					      SET category = 'own_wallet', notes = COALESCE(notes, ?)
					      WHERE id = ? AND tenant_id = ?`,
					args: [note, id, tenantId],
				}),
			),
		);
	}

	return updates.length;
}
