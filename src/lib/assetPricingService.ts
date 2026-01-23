import { db } from '@/lib/db';
import { getTickersUSD } from '@/lib/coinpaprikaProvider';

const MIN_VALUE_USD = 5;
const PRICE_STALE_MS = 10 * 60 * 1000;

type MappingRow = {
	chain_id: number | string;
	contract_address: string;
	coinpaprika_id: string;
};

type TrackedAssetRow = {
	id: string;
	user_id: string;
	chain_id: number | string;
	contract_address: string;
	balance: number | string | null;
	token_symbol: string | null;
	token_name: string | null;
	is_hidden: number | boolean | null;
	last_priced_at: string | number | null;
};

function isSpamToken(symbol: string | null, name: string | null) {
	const sym = (symbol ?? '').trim().toLowerCase();
	const nm = (name ?? '').trim().toLowerCase();
	const haystack = `${sym} ${nm}`;
	return /(claim|airdrop|reward|bonus|\.com|visit)/.test(haystack);
}

function toNumber(value: number | string | null | undefined) {
	if (value === null || value === undefined) return 0;
	const num = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(num) ? num : 0;
}

function isStale(lastPricedAt: TrackedAssetRow['last_priced_at']) {
	if (!lastPricedAt) return true;
	if (typeof lastPricedAt === 'number') {
		return lastPricedAt < Date.now() - PRICE_STALE_MS;
	}
	const parsed = new Date(lastPricedAt).getTime();
	if (Number.isNaN(parsed)) return true;
	return parsed < Date.now() - PRICE_STALE_MS;
}

export async function priceTrackedAssets(userId: string) {
	const tickers = (await getTickersUSD()) as Array<{
		id?: string;
		quotes?: { USD?: { price?: number } };
	}>;
	const priceMap = new Map<string, number>();
	for (const ticker of tickers) {
		const id = String(ticker.id ?? '').trim();
		const price = ticker.quotes?.USD?.price;
		if (id && typeof price === 'number') {
			priceMap.set(id, price);
		}
	}

	const mappingResult = await db.execute({
		sql: `SELECT chain_id, contract_address, coinpaprika_id
			FROM token_price_mapping`,
		args: [],
	});
	const mappingRows = mappingResult.rows as unknown as MappingRow[];
	const mapping = new Map<string, string>();
	for (const row of mappingRows) {
		if (!row?.coinpaprika_id) continue;
		const key = `${row.chain_id}:${String(row.contract_address ?? '').toLowerCase()}`;
		mapping.set(key, row.coinpaprika_id);
	}

	const assetResult = await db.execute({
		sql: `SELECT id, user_id, chain_id, contract_address, balance, token_symbol, token_name, is_hidden, last_priced_at
			FROM tracked_assets
			WHERE user_id = ?`,
		args: [userId],
	});
	const assets = assetResult.rows as unknown as TrackedAssetRow[];
	let updated = 0;
	let hidden = 0;

	for (const asset of assets) {
		const hiddenFlag = Boolean(asset.is_hidden);
		if (hiddenFlag && !isStale(asset.last_priced_at)) continue;

		const balance = toNumber(asset.balance);
		const key = `${asset.chain_id}:${String(asset.contract_address ?? '').toLowerCase()}`;
		const coinpaprikaId = mapping.get(key);
		const spam = balance === 0 || isSpamToken(asset.token_symbol, asset.token_name);

		if (!coinpaprikaId || spam) {
			await db.execute({
				sql: `UPDATE tracked_assets
					SET is_hidden = 1, last_priced_at = CURRENT_TIMESTAMP
					WHERE id = ?`,
				args: [asset.id],
			});
			hidden += 1;
			continue;
		}

		const priceUsd = priceMap.get(coinpaprikaId) ?? 0;
		const valueUsd = balance * priceUsd;
		const shouldHide = valueUsd < MIN_VALUE_USD;

		await db.execute({
			sql: `UPDATE tracked_assets
				SET last_price_usd = ?, last_value_usd = ?, last_priced_at = CURRENT_TIMESTAMP, is_hidden = ?
				WHERE id = ?`,
			args: [priceUsd, valueUsd, shouldHide ? 1 : 0, asset.id],
		});
		if (shouldHide) {
			hidden += 1;
		} else {
			updated += 1;
		}
	}

	return { updated, hidden, total: assets.length };
}
