// src/lib/sync/syncSuiTransactions.ts
import { db } from '@/lib/db';
import {
	queryTransactionBlocks,
	parseSuiSymbol,
	SUI_DECIMALS,
	SUI_NATIVE_TYPE,
	type SuiBalanceChange,
} from '@/lib/sui';
import type { Wallet } from '@/lib/wallets';

const SUI_CHAIN = 'sui';

function resolveOwner(owner: SuiBalanceChange['owner']): string {
	if (typeof owner === 'string') return owner.toLowerCase();
	return (owner?.AddressOwner ?? '').toLowerCase();
}

function isSuiType(coinType: string): boolean {
	return (
		coinType === SUI_NATIVE_TYPE ||
		coinType.toLowerCase().endsWith('::sui::sui')
	);
}

function resolveDecimals(coinType: string): number {
	return isSuiType(coinType) ? SUI_DECIMALS : 9;
}

export async function syncSuiTransactions(
	tenantId: string,
	wallet: Wallet,
): Promise<{ inserted: number; skipped: number }> {
	const address = wallet.address.toLowerCase();
	let inserted = 0;
	let skipped = 0;

	// Load cursor from last sync (stored in last_timestamp column)
	const stateResult = await db.execute({
		sql: `SELECT last_timestamp FROM wallet_sync_state
              WHERE wallet_id = ? AND chain = ? AND tenant_id = ? LIMIT 1`,
		args: [wallet.id, SUI_CHAIN, tenantId],
	});
	const stateRow = stateResult.rows[0] as Record<string, any> | undefined;
	let cursor: string | null = null;
	if (stateRow?.last_timestamp) {
		const raw = String(stateRow.last_timestamp);
		// Only use as a Sui cursor if it doesn't look like an ISO date
		if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) {
			cursor = raw;
		}
	}

	let hasMore = true;
	let latestTimestamp: string | null = null;
	let nextCursor: string | null = cursor;

	while (hasMore) {
		const page = await queryTransactionBlocks(address, nextCursor);

		for (const tx of page.data) {
			const digest = tx.digest;
			const tsMs = tx.timestampMs ? Number(tx.timestampMs) : null;
			const timestamp = tsMs
				? new Date(tsMs).toISOString()
				: new Date().toISOString();

			if (!latestTimestamp || timestamp > latestTimestamp) {
				latestTimestamp = timestamp;
			}

			const status = tx.effects?.status?.status ?? null;
			const gasUsed = tx.effects?.gasUsed;
			let feeMist: bigint = 0n;
			if (gasUsed) {
				try {
					feeMist =
						BigInt(gasUsed.computationCost) +
						BigInt(gasUsed.storageCost) -
						BigInt(gasUsed.storageRebate);
					if (feeMist < 0n) feeMist = 0n;
				} catch {}
			}

			const balanceChanges = Array.isArray(tx.balanceChanges)
				? tx.balanceChanges.filter(
						(c) => resolveOwner(c.owner) === address,
					)
				: [];

			if (balanceChanges.length === 0) {
				// Fee-only row — our wallet paid gas but had no other balance change
				const id = `${digest}:fee`;
				try {
					await db.execute({
						sql: `INSERT INTO sui_transactions
                          (id, wallet_id, tenant_id, digest, coin_type, symbol, amount, decimals, timestamp, fee_mist, status)
                          VALUES (?, ?, ?, ?, ?, 'SUI', '0', 9, ?, ?, ?)
ON CONFLICT DO NOTHING`,
						args: [
							id,
							wallet.id,
							tenantId,
							digest,
							SUI_NATIVE_TYPE,
							timestamp,
							feeMist.toString(),
							status,
						],
					});
					inserted++;
				} catch {
					skipped++;
				}
				continue;
			}

			for (const change of balanceChanges) {
				const coinType = change.coinType;
				const symbol = parseSuiSymbol(coinType);
				const decimals = resolveDecimals(coinType);

				// Make coin_type DB-safe and short enough for a key
				const safeCoin = coinType
					.replace(/[^a-z0-9_]/gi, '_')
					.slice(0, 80);
				const id = `${digest}:${safeCoin}`;

				try {
					await db.execute({
						sql: `INSERT INTO sui_transactions
                          (id, wallet_id, tenant_id, digest, coin_type, symbol, amount, decimals, timestamp, fee_mist, status)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT DO NOTHING`,
						args: [
							id,
							wallet.id,
							tenantId,
							digest,
							coinType,
							symbol,
							change.amount, // signed string, negative = out
							decimals,
							timestamp,
							feeMist.toString(),
							status,
						],
					});
					inserted++;
				} catch {
					skipped++;
				}
			}
		}

		hasMore = page.hasNextPage;
		nextCursor = page.nextCursor;
		if (!hasMore) break;
	}

	// Save sync state
	const now = new Date().toISOString();
	await db.execute({
		sql: `INSERT INTO wallet_sync_state
              (wallet_id, chain, tenant_id, last_block_number, last_timestamp, last_run_at)
              VALUES (?, ?, ?, 0, ?, ?)
              ON CONFLICT(tenant_id, wallet_id, chain) DO UPDATE SET
                last_timestamp = excluded.last_timestamp,
                last_run_at    = excluded.last_run_at`,
		args: [
			wallet.id,
			SUI_CHAIN,
			tenantId,
			nextCursor ?? now,   // store nextCursor (or now if fully synced)
			now,
		],
	});

	return { inserted, skipped };
}
