import { db } from '@/lib/db';
import { tryAcquireLock } from '@/lib/cacheLock';
import { getSimpleTokenPrices } from '@/lib/prices/coingecko';
import { rebuildAssetLifecycles } from '@/lib/lifecycle';

const DEFAULT_LOCK_TTL_SECONDS = 120;

type SnapshotRow = {
	id: string;
	wallet_id: string;
	chain: string;
	payload_json: string | null;
	totals_usd: number | null;
	captured_at: string | null;
};

type RepriceOptions = {
	tenantId: string;
	walletId?: string;
	symbols?: string[];
	source?: 'coingecko';
	trigger?: 'price-failure' | 'view' | 'cron' | 'snapshot-insert';
	lockTtlSeconds?: number;
};

const normalizeSymbol = (value: unknown) => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed ? trimmed.toUpperCase() : null;
};

const coerceNumber = (value: unknown) => {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string') {
		const cleaned = value.replace(/,/g, '').trim();
		const parsed = Number(cleaned);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

const getTokenAmount = (token: Record<string, unknown>) => {
	if ('amount' in token) return coerceNumber(token.amount);
	if ('balance' in token) return coerceNumber(token.balance);
	return null;
};

const getTokenValue = (token: Record<string, unknown>) => {
	if ('valueUsd' in token) return coerceNumber(token.valueUsd);
	if ('usdValue' in token) return coerceNumber(token.usdValue);
	return null;
};

const setTokenValue = (token: Record<string, unknown>, valueUsd: number) => {
	if ('valueUsd' in token || !('usdValue' in token)) {
		token.valueUsd = valueUsd;
		return;
	}
	token.usdValue = valueUsd;
};

const setTokenPrice = (token: Record<string, unknown>, priceUsd: number) => {
	token.priceUsd = priceUsd;
};

const isValidPositive = (value: number | null) => value !== null && Number.isFinite(value) && value > 0;

/**
 * Repairs wallet snapshots with missing prices by re-fetching prices and updating payload_json.
 * This avoids zero-price poisoning when upstream price providers fail.
 */
export async function repriceMissingWalletTokens(options: RepriceOptions) {
	const { tenantId, walletId, symbols, source = 'coingecko', trigger, lockTtlSeconds } = options;
	const lockKey = `lock:reprice:${tenantId}:${walletId ?? 'all'}`;
	const gotLock = await tryAcquireLock(lockKey, lockTtlSeconds ?? DEFAULT_LOCK_TTL_SECONDS);
	if (!gotLock) {
		console.info('[reprice] skipped (lock)', { tenantId, walletId, trigger });
		return { ok: true, skipped: true, reason: 'locked' };
	}

	const start = Date.now();
	console.info('[reprice] start', { tenantId, walletId, trigger, source });

	const baseArgs: any[] = [tenantId];
	let walletClause = '';
	if (walletId) {
		walletClause = 'AND wallet_id = ?';
		baseArgs.push(walletId);
	}
	const args = [...baseArgs, ...baseArgs];

	const result = await db.execute({
		sql: `WITH latest AS (
				SELECT wallet_id, chain, MAX(captured_at) AS captured_at
				FROM wallet_snapshots
				WHERE tenant_id = ? ${walletClause}
				GROUP BY wallet_id, chain
			)
			SELECT ws.id AS id,
			       ws.wallet_id AS wallet_id,
			       ws.chain AS chain,
			       ws.payload_json AS payload_json,
			       ws.totals_usd AS totals_usd,
			       ws.captured_at AS captured_at
			FROM wallet_snapshots ws
			JOIN latest l
			  ON l.wallet_id = ws.wallet_id
			 AND l.chain = ws.chain
			 AND l.captured_at = ws.captured_at
			WHERE ws.tenant_id = ? ${walletClause}`,
		args,
	});

	const rows = result.rows as unknown as SnapshotRow[];
	const rowsToUpdate: Array<{ row: SnapshotRow; tokens: Record<string, unknown>[] }> = [];
	const missingSymbols = new Set<string>();

	for (const row of rows) {
		if (!row.payload_json) continue;
		let tokens: Record<string, unknown>[] = [];
		try {
			const parsed = JSON.parse(row.payload_json);
			if (Array.isArray(parsed)) {
				tokens = parsed as Record<string, unknown>[];
			}
		} catch {
			continue;
		}

		for (const token of tokens) {
			const symbol = normalizeSymbol(token.symbol ?? token.tokenSymbol);
			if (!symbol) continue;
			const tokenSource = String(token.source ?? '').toLowerCase();
			if (tokenSource === 'aave' || tokenSource === 'defi') continue;
			if (Array.isArray(symbols) && symbols.length && !symbols.includes(symbol)) continue;
			const amount = getTokenAmount(token);
			if (!isValidPositive(amount)) continue;
			const price = coerceNumber(token.priceUsd);
			const value = getTokenValue(token);
			const needsPrice = !isValidPositive(price);
			const needsValue = !isValidPositive(value);
			if (needsPrice || needsValue) {
				missingSymbols.add(symbol);
			}
		}

		rowsToUpdate.push({ row, tokens });
	}

	const symbolsToFetch = Array.isArray(symbols) && symbols.length ? symbols : Array.from(missingSymbols);
	if (!symbolsToFetch.length) {
		console.info('[reprice] nothing to reprice', { tenantId, walletId });
		return { ok: true, updatedRows: 0, updatedTokens: 0, elapsedMs: Date.now() - start };
	}

	let priceMap: Record<string, number> = {};
	try {
		priceMap = source === 'coingecko' ? await getSimpleTokenPrices(symbolsToFetch) : {};
	} catch (error) {
		console.warn('[reprice] provider failure', { tenantId, walletId, source, error });
	}

	if (!Object.keys(priceMap).length) {
		console.warn('[reprice] no prices returned', { tenantId, walletId, source, symbols: symbolsToFetch });
		return { ok: true, updatedRows: 0, updatedTokens: 0, elapsedMs: Date.now() - start };
	}

	let updatedTokens = 0;
	let updatedRows = 0;
	const walletsTouched = new Set<string>();
	const symbolsUpdated = new Set<string>();

	for (const entry of rowsToUpdate) {
		let rowChanged = false;
		for (const token of entry.tokens) {
			const symbol = normalizeSymbol(token.symbol ?? token.tokenSymbol);
			if (!symbol) continue;
			const tokenSource = String(token.source ?? '').toLowerCase();
			if (tokenSource === 'aave' || tokenSource === 'defi') continue;
			if (Array.isArray(symbols) && symbols.length && !symbols.includes(symbol)) continue;
			const amount = getTokenAmount(token);
			if (!isValidPositive(amount)) continue;
			const priceCurrent = coerceNumber(token.priceUsd);
			const valueCurrent = getTokenValue(token);
			const needsPrice = !isValidPositive(priceCurrent);
			const needsValue = !isValidPositive(valueCurrent);
			if (!needsPrice && !needsValue) continue;

			const newPrice = priceMap[symbol];
			if (!isValidPositive(newPrice)) continue;

			if (needsPrice) {
				setTokenPrice(token, newPrice);
				rowChanged = true;
			}
			if (needsValue) {
				const nextValue = amount * newPrice;
				if (Number.isFinite(nextValue) && nextValue > 0) {
					setTokenValue(token, nextValue);
					rowChanged = true;
				}
			}
			if (rowChanged) updatedTokens += 1;
			if (rowChanged) symbolsUpdated.add(symbol);
		}

		if (!rowChanged) continue;

		const totalsUsd = entry.tokens.reduce((sum, token) => {
			const value = getTokenValue(token);
			return sum + (isValidPositive(value) ? value : 0);
		}, 0);

		await db.execute({
			sql: `UPDATE wallet_snapshots
				SET payload_json = ?, totals_usd = ?
				WHERE id = ? AND tenant_id = ?`,
			args: [JSON.stringify(entry.tokens), totalsUsd, entry.row.id, tenantId],
		});

		walletsTouched.add(entry.row.wallet_id);
		updatedRows += 1;
	}

	if (walletsTouched.size) {
		console.info('[reprice] repriced', {
			tenantId,
			wallets: Array.from(walletsTouched),
			updatedRows,
			updatedTokens,
			symbols: Array.from(symbolsUpdated),
		});
		await rebuildAssetLifecycles(tenantId);
	}

	console.info('[reprice] done', {
		tenantId,
		walletId,
		updatedRows,
		updatedTokens,
		elapsedMs: Date.now() - start,
	});

	return {
		ok: true,
		updatedRows,
		updatedTokens,
		walletsTouched: Array.from(walletsTouched),
		elapsedMs: Date.now() - start,
	};
}
