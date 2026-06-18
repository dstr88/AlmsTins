// src/lib/cexSnapshot.ts
//
// After a CEX CSV import, call snapshotCexAccount() to compute current holdings
// from import_transactions and write a wallet_snapshot row. This makes CEX
// balances visible in the PortfolioTile (which reads from wallet_snapshots).

import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { computeHoldings, type ImportRow } from '@/lib/exchangeHoldings';
import { getTickersUSD } from '@/lib/coinpaprikaProvider';
import { allowlistSymbols } from '@/lib/prices/sanitizeSymbols';
import { fetchStockPrices } from '@/lib/stockPriceProvider';

const STOCK_SOURCES = new Set(['robinhood']);

const CEX_CHAIN = 'exchange';

const normalizeSymbol = (s: string): string => {
	const u = s.trim().toUpperCase();
	if (u === 'MATIC' || u === 'WMATIC') return 'POL';
	if (u === 'WBTC') return 'BTC';
	if (u === 'WETH') return 'ETH';
	if (u.endsWith('.E')) return u.slice(0, -2);
	return u;
};

async function fetchPricesForSymbols(symbols: string[]): Promise<Record<string, number>> {
	const allowed = allowlistSymbols(symbols);
	if (!allowed.length) return {};

	const tickers = (await getTickersUSD()) as Array<{
		symbol?: string;
		rank?: number;
		quotes?: { USD?: { price?: number } };
	}>;

	const symbolSet = new Set(allowed);
	const candidates = new Map<string, Array<{ price: number; rank: number }>>();

	for (const ticker of tickers) {
		const sym = String(ticker.symbol ?? '').trim().toUpperCase();
		if (!sym || !symbolSet.has(sym)) continue;
		const price = ticker.quotes?.USD?.price;
		if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue;
		const rank =
			typeof ticker.rank === 'number' && Number.isFinite(ticker.rank) ? ticker.rank : 999999;
		const list = candidates.get(sym) ?? [];
		list.push({ price, rank });
		candidates.set(sym, list);
	}

	const priceMap: Record<string, number> = {};
	for (const sym of symbolSet) {
		const list = candidates.get(sym);
		if (!list?.length) continue;
		list.sort((a, b) => a.rank - b.rank);
		priceMap[sym] = list[0].price;
	}
	return priceMap;
}

async function ensureCexWallet(
	tenantId: string,
	accountId: string,
	source: string,
	displayName: string,
): Promise<string> {
	const address = `cex:${source}:${accountId}`;

	const existing = await db.execute({
		sql: `SELECT id FROM wallets WHERE tenant_id = ? AND address = ? LIMIT 1`,
		args: [tenantId, address],
	});

	if (existing.rows?.length) {
		return String(existing.rows[0].id ?? '');
	}

	const id = randomUUID();
	await db.execute({
		sql: `INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
		      VALUES (?, ?, ?, ?, '[]', 0, 'exchange')`,
		args: [id, tenantId, address, displayName],
	});
	return id;
}

/**
 * Computes current holdings for a CEX account from its import_transactions,
 * prices them via Coinpaprika, and writes a wallet_snapshot row so the
 * PortfolioTile can include CEX balances in the grand total.
 *
 * Safe to call fire-and-forget (all errors are caught internally).
 */
export async function snapshotCexAccount(
	tenantId: string,
	accountId: string,
	source: string,
	displayName: string,
): Promise<void> {
	try {
		const result = await db.execute({
			sql: `SELECT timestamp_utc, asset_symbol, direction, currency, amount,
			             to_currency, to_amount, native_usd, kind, description
			      FROM import_transactions
			      WHERE tenant_id = ? AND account_id = ?
			      ORDER BY timestamp_utc ASC`,
			args: [tenantId, accountId],
		});

		if (!result.rows?.length) return;

		const rows: ImportRow[] = (result.rows as any[]).map((row) => ({
			timestamp_utc: String(row.timestamp_utc ?? ''),
			asset_symbol: row.asset_symbol != null ? String(row.asset_symbol) : null,
			direction: row.direction != null ? String(row.direction) : null,
			currency: row.currency != null ? String(row.currency) : null,
			amount: row.amount != null ? Number(row.amount) : null,
			to_currency: row.to_currency != null ? String(row.to_currency) : null,
			to_amount: row.to_amount != null ? Number(row.to_amount) : null,
			native_usd: row.native_usd != null ? Number(row.native_usd) : null,
			kind: row.kind != null ? String(row.kind) : null,
			description: row.description != null ? String(row.description) : null,
		}));

		const holdings = computeHoldings(rows);
		const active = holdings.filter((h) => h.balance + h.staked > 0.000001);

		// Even if the wallet is now empty (all transferred out), still write a
		// $0 snapshot so the wallet shows as synced rather than "Never".
		let priceMap: Record<string, number> = {};
		if (active.length) {
			const symbols = active.map((h) => normalizeSymbol(h.symbol));
			try {
				priceMap = STOCK_SOURCES.has(source)
					? await fetchStockPrices(symbols)
					: await fetchPricesForSymbols(symbols);
			} catch (err) {
				console.warn('[cexSnapshot] price fetch failed, proceeding with null prices', {
					source,
					err,
				});
			}
		}

		const tokens = active.map((h) => {
			const sym = normalizeSymbol(h.symbol);
			const amount = h.balance + h.staked;
			const priceUsd = priceMap[sym] ?? null;
			const valueUsd = priceUsd !== null ? amount * priceUsd : null;
			return { symbol: sym, amount, priceUsd, valueUsd, tokenAddress: null };
		});

		const totalUsd = tokens.reduce((s, t) => s + (t.valueUsd ?? 0), 0);
		const walletId = await ensureCexWallet(tenantId, accountId, source, displayName);

		await db.execute({
			sql: `INSERT INTO wallet_snapshots
			        (tenant_id, wallet_id, chain, totals_usd,
			         collateral_usd, debt_usd, collateral_apy_pct,
			         borrow_apy_pct, net_rate_pct, payload_json, captured_at)
			      VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`,
			args: [tenantId, walletId, CEX_CHAIN, totalUsd, JSON.stringify(tokens)],
		});

		// Invalidate the cached networth summary so the portfolio tile reflects this import
		try {
			await db.execute({
				sql: `DELETE FROM cache WHERE cache_key = ?`,
				args: [`t:${tenantId}:networth:summary:v3`],
			});
		} catch {
			// Cache invalidation is best-effort
		}

		console.log('[cexSnapshot] snapshot written', {
			source,
			accountId,
			walletId,
			totalUsd,
			tokenCount: tokens.length,
		});
	} catch (err) {
		console.error('[cexSnapshot] snapshot failed', { source, accountId, err });
	}
}
