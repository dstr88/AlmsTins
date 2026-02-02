import { db } from '@/lib/db';
import { tryAcquireLock } from '@/lib/cacheLock';
import { getSimpleTokenPrices } from '@/lib/prices/coingecko';
import { rebuildAssetLifecycles } from '@/lib/lifecycle';
import { invalidateWalletCache } from '@/lib/db/puller';

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
	if (!trimmed) return null;
	const upper = trimmed.toUpperCase();
	if (upper === 'MATIC' || upper === 'WMATIC') return 'POL';
	if (upper === 'WETH') return 'WETH';
	if (upper === 'ETH') return 'ETH';
	if (upper === 'AVAX') return 'AVAX';
	if (upper === 'USDC') return 'USDC';
	if (upper === 'USDT') return 'USDT';
	if (upper === 'POL') return 'POL';
	return upper;
};

const COINGECKO_ID_TO_SYMBOL: Record<string, string> = {
	bitcoin: 'BTC',
	ethereum: 'ETH',
	'polygon-ecosystem-token': 'POL',
	'avalanche-2': 'AVAX',
	arbitrum: 'ARB',
	weth: 'WETH',
};

const normalizePriceMap = (raw: Record<string, number>) => {
	const mapped: Record<string, number> = {};
	for (const [key, value] of Object.entries(raw)) {
		const normalizedKey = normalizeSymbol(key) ?? COINGECKO_ID_TO_SYMBOL[key.toLowerCase()];
		if (!normalizedKey) continue;
		mapped[normalizedKey] = value;
	}
	return mapped;
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

const setTokenValue = (token: Record<string, unknown>, valueUsd: number | null) => {
	if ('valueUsd' in token || !('usdValue' in token)) {
		token.valueUsd = valueUsd;
		return;
	}
	token.usdValue = valueUsd;
};

const setTokenPrice = (token: Record<string, unknown>, priceUsd: number | null) => {
	token.priceUsd = priceUsd;
};

const isValidPositive = (value: number | null) => value !== null && Number.isFinite(value) && value > 0;

const shouldReprice = (price: number | null, value: number | null, amount: number | null) => {
	if (!isValidPositive(amount)) return false;
	if (price === null || price <= 0 || !Number.isFinite(price)) return true;
	if (value === null || value <= 0 || !Number.isFinite(value)) return true;
	return false;
};

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

	const symbolFilter = Array.isArray(symbols) && symbols.length
		? new Set(symbols.map((sym) => normalizeSymbol(sym)).filter((sym): sym is string => Boolean(sym)))
		: null;

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
	const rowsToUpdate: Array<{
		row: SnapshotRow;
		tokens: Record<string, unknown>[];
		tokensBefore: Array<{ symbol: string; priceUsd: number | null; valueUsd: number | null; amount: number | null }>;
		normalizedZeroes: boolean;
	}> = [];
	const missingSymbols = new Set<string>();
	const snapshotSummaries: Array<{ snapshotId: string; walletId: string; chain: string }> = [];

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

		let normalizedZeroes = false;
		const tokensBefore = tokens.map((token) => ({
			symbol: normalizeSymbol((token as Record<string, unknown>).symbol ?? (token as Record<string, unknown>).tokenSymbol) ?? 'UNKNOWN',
			priceUsd: coerceNumber((token as Record<string, unknown>).priceUsd),
			valueUsd: getTokenValue(token),
			amount: getTokenAmount(token),
		}));

		for (const token of tokens) {
			const symbol = normalizeSymbol(token.symbol ?? token.tokenSymbol);
			if (!symbol) continue;
			const tokenSource = String(token.source ?? '').toLowerCase();
			if (tokenSource === 'aave' || tokenSource === 'defi') continue;
			if (symbolFilter && !symbolFilter.has(symbol)) continue;
			const amount = getTokenAmount(token);
			const price = coerceNumber(token.priceUsd);
			const value = getTokenValue(token);
			const priceInvalid = price === null || !Number.isFinite(price) || price <= 0;
			const valueInvalid = value === null || !Number.isFinite(value) || value <= 0;
			const priceNorm = priceInvalid ? null : price;
			const valueNorm = valueInvalid ? null : value;

			if (priceInvalid && price !== null) {
				setTokenPrice(token, null);
				normalizedZeroes = true;
			}
			if (valueInvalid && value !== null) {
				setTokenValue(token, null);
				normalizedZeroes = true;
			}
			if (shouldReprice(priceNorm, valueNorm, amount)) {
				if (priceInvalid && isValidPositive(amount)) {
					missingSymbols.add(symbol);
				}
			}
		}

		rowsToUpdate.push({ row, tokens, tokensBefore, normalizedZeroes });
		snapshotSummaries.push({ snapshotId: row.id, walletId: row.wallet_id, chain: row.chain });
	}

	const symbolsToFetch = Array.from(missingSymbols);
	console.info('[reprice] snapshots', { tenantId, walletId, snapshots: snapshotSummaries });
	console.info('[reprice] computed symbolsToPrice', { tenantId, walletId, symbols: symbolsToFetch });

	let priceMap: Record<string, number> = {};
	if (symbolsToFetch.length) {
		try {
			priceMap = source === 'coingecko' ? await getSimpleTokenPrices(symbolsToFetch) : {};
		} catch (error) {
			console.warn('[reprice] provider failure', { tenantId, walletId, source, error });
		}
	}

	const normalizedPriceMap = normalizePriceMap(priceMap);

	console.info('[reprice] priceMap', {
		tenantId,
		walletId,
		source,
		priceMapKeys: Object.keys(priceMap),
		normalizedKeys: Object.keys(normalizedPriceMap),
		ethPrice: normalizedPriceMap.ETH ?? priceMap.ETH ?? priceMap.ethereum,
	});

	let updatedTokens = 0;
	let updatedRows = 0;
	const walletsTouched = new Set<string>();
	const symbolsUpdated = new Set<string>();

	for (const entry of rowsToUpdate) {
		let rowChanged = entry.normalizedZeroes;

		for (const token of entry.tokens) {
			const symbol = normalizeSymbol(token.symbol ?? token.tokenSymbol);
			if (!symbol) continue;
			const tokenSource = String(token.source ?? '').toLowerCase();
			if (tokenSource === 'aave' || tokenSource === 'defi') continue;
			if (symbolFilter && !symbolFilter.has(symbol)) continue;
			const amount = getTokenAmount(token);
			const priceCurrent = coerceNumber(token.priceUsd);
			const valueCurrent = getTokenValue(token);

			const needsReprice = shouldReprice(priceCurrent, valueCurrent, amount);
			if (!needsReprice) continue;

			const newPrice = isValidPositive(priceCurrent) ? priceCurrent : normalizedPriceMap[symbol];
			if (isValidPositive(newPrice)) {
				if (!isValidPositive(priceCurrent)) {
					setTokenPrice(token, newPrice);
					rowChanged = true;
				}
				if (isValidPositive(amount)) {
					const nextValue = amount * newPrice;
					if (Number.isFinite(nextValue) && nextValue > 0) {
						setTokenValue(token, nextValue);
						rowChanged = true;
					} else {
						setTokenValue(token, null);
						rowChanged = true;
					}
				}
			} else {
				if (!isValidPositive(priceCurrent) && priceCurrent !== null) {
					setTokenPrice(token, null);
					rowChanged = true;
				}
				if (!isValidPositive(valueCurrent) && valueCurrent !== null) {
					setTokenValue(token, null);
					rowChanged = true;
				}
			}

		}

		if (!rowChanged) continue;

		const tokensAfter = entry.tokens.map((token) => ({
			symbol: normalizeSymbol((token as Record<string, unknown>).symbol ?? (token as Record<string, unknown>).tokenSymbol) ?? 'UNKNOWN',
			priceUsd: coerceNumber((token as Record<string, unknown>).priceUsd),
			valueUsd: getTokenValue(token),
			amount: getTokenAmount(token),
		}));

		const tokenChangeCount = tokensAfter.reduce((count, token, idx) => {
			const before = entry.tokensBefore[idx];
			if (!before) return count;
			if (before.priceUsd !== token.priceUsd || before.valueUsd !== token.valueUsd) {
				if (token.symbol) {
					symbolsUpdated.add(token.symbol);
				}
				return count + 1;
			}
			return count;
		}, 0);

		if (tokenChangeCount) {
			updatedTokens += tokenChangeCount;
		}

		const totalsUsd = entry.tokens.reduce((sum, token) => {
			const value = getTokenValue(token);
			return sum + (isValidPositive(value) ? value : 0);
		}, 0);

		console.info('[reprice] snapshot before', {
			tenantId,
			walletId: entry.row.wallet_id,
			snapshotId: entry.row.id,
			chain: entry.row.chain,
			tokens: entry.tokensBefore,
		});
		console.info('[reprice] snapshot after', {
			tenantId,
			walletId: entry.row.wallet_id,
			snapshotId: entry.row.id,
			chain: entry.row.chain,
			tokens: tokensAfter,
		});

		const updateResult = await db.execute({
			sql: `UPDATE wallet_snapshots
				SET payload_json = ?, totals_usd = ?
				WHERE id = ? AND tenant_id = ?`,
			args: [JSON.stringify(entry.tokens), totalsUsd, entry.row.id, tenantId],
		});

		const rowsAffected = (updateResult as any)?.rowsAffected ?? (updateResult as any)?.changes ?? null;
		console.info('[reprice] truth-dump', {
			tenantId,
			walletId: entry.row.wallet_id,
			snapshotId: entry.row.id,
			chain: entry.row.chain,
			tokenCount: entry.tokens.length,
			firstTokens: tokensAfter.slice(0, 3),
			totalsUsd,
			rowsAffected,
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
		for (const touchedWalletId of walletsTouched) {
			invalidateWalletCache(touchedWalletId, tenantId);
		}
		await db.execute({
			sql: 'DELETE FROM cache WHERE cache_key = ?',
			args: [`t:${tenantId}:networth:summary:v2`],
		});
		console.info('[reprice] networth summary cache invalidated', { tenantId });
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
