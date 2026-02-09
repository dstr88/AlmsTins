import { db } from '@/lib/db';
import type { SupportedChain } from '@/lib/constants';
import { getAaveTotalsForWallet } from '@/lib/aave/client';
import { repriceMissingWalletTokens } from '@/lib/repriceMissingWalletTokens';

export type NetWorthRow = {
	walletId: string;
	walletLabel: string | null;
	address: string;
	chain: string;
	tokenSymbol: string | null;
	amount: string;
	usdValue: number;
	freeUsd: number;
	collateralUsd: number;
	debtUsd: number;
	capturedAt: string;
};

export type NetWorthSummary = {
	totalUsdValue: number;
	totalSellableUsd: number;
	totalCollateralUsd: number;
	totalDebtUsd: number;
	rows: NetWorthRow[];
};

export type LatestNetWorthSummary = {
	// Backward-compatible fields
	totalUsd: number;
	byWallet: Array<{
		walletId: string;
		walletLabel: string | null;
		walletAddress: string;
		totalUsd: number;
		byChain: Array<{
			chain: string;
			totalUsd: number;
			capturedAt: string;
			assetsUsd?: number;
			freeAssetsUsd?: number;
			debtUsd?: number;
		}>;
	}>;
	byChain: Array<{ chain: string; totalUsd: number; assetsUsd?: number; freeAssetsUsd?: number; debtUsd?: number }>;
	// New richer fields for Totals tin
	totalAssetsUsd: number;
	totalFreeAssetsUsd: number;
	totalDebtUsd: number;
	tins?: Array<{
		tinId: string;
		tinName: string | null;
		assetsUsd: number;
		freeAssetsUsd: number;
		debtUsd: number;
		netUsd: number;
	}>;
	aaveIncluded?: boolean;
};

type DbRow = Record<string, unknown>;

const toStringOrEmpty = (value: unknown) => (typeof value === 'string' ? value : '');
const toStringOrNull = (value: unknown) => (typeof value === 'string' ? value : value === null ? null : null);
const toNumberOrNull = (value: unknown) => (typeof value === 'number' ? value : value === null ? null : null);

const toWalletRow = (row: unknown): { id?: string; address?: string; label?: string } | null => {
	if (!row || typeof row !== 'object') return null;
	const r = row as DbRow;
	return {
		id: typeof r.id === 'string' ? r.id : undefined,
		address: typeof r.address === 'string' ? r.address : undefined,
		label: typeof r.label === 'string' ? r.label : undefined,
	};
};

type NetWorthSnapshotRow = {
	walletId: string;
	walletLabel: string | null;
	address: string;
	chain: string;
	payloadJson: string | null;
	capturedAt: string;
};

const toNetWorthSnapshotRow = (row: unknown): NetWorthSnapshotRow | null => {
	if (!row || typeof row !== 'object') return null;
	const r = row as DbRow;
	return {
		walletId: toStringOrEmpty(r.walletId),
		walletLabel: toStringOrNull(r.walletLabel),
		address: toStringOrEmpty(r.address),
		chain: toStringOrEmpty(r.chain),
		payloadJson: toStringOrNull(r.payloadJson),
		capturedAt: toStringOrEmpty(r.capturedAt),
	};
};

const toNetWorthSnapshotRows = (rows: unknown): NetWorthSnapshotRow[] => {
	if (!Array.isArray(rows)) return [];
	const out: NetWorthSnapshotRow[] = [];
	for (const row of rows) {
		const mapped = toNetWorthSnapshotRow(row);
		if (mapped) out.push(mapped);
	}
	return out;
};

type LatestNetWorthRow = {
	walletId: string;
	walletLabel: string | null;
	walletAddress: string;
	chain: string;
	totalsUsd: number;
	capturedAt: string;
};

const toLatestNetWorthRow = (row: unknown): LatestNetWorthRow | null => {
	if (!row || typeof row !== 'object') return null;
	const r = row as DbRow;
	return {
		walletId: toStringOrEmpty(r.walletId),
		walletLabel: toStringOrNull(r.walletLabel),
		walletAddress: toStringOrEmpty(r.walletAddress),
		chain: toStringOrEmpty(r.chain),
		totalsUsd: typeof r.totalsUsd === 'number' ? r.totalsUsd : 0,
		capturedAt: toStringOrEmpty(r.capturedAt),
	};
};

const toLatestNetWorthRows = (rows: unknown): LatestNetWorthRow[] => {
	if (!Array.isArray(rows)) return [];
	const out: LatestNetWorthRow[] = [];
	for (const row of rows) {
		const mapped = toLatestNetWorthRow(row);
		if (mapped) out.push(mapped);
	}
	return out;
};

type WalletSnapshotRow = {
	id: string;
	chain: string;
	payloadJson: string | null;
	capturedAt: string;
	totalsUsd: number | null;
};

const toWalletSnapshotRow = (row: unknown): WalletSnapshotRow | null => {
	if (!row || typeof row !== 'object') return null;
	const r = row as DbRow;
	return {
		id: toStringOrEmpty(r.id),
		chain: toStringOrEmpty(r.chain),
		payloadJson: toStringOrNull(r.payloadJson),
		capturedAt: toStringOrEmpty(r.capturedAt),
		totalsUsd: toNumberOrNull(r.totalsUsd),
	};
};

const toWalletSnapshotRows = (rows: unknown): WalletSnapshotRow[] => {
	if (!Array.isArray(rows)) return [];
	const out: WalletSnapshotRow[] = [];
	for (const row of rows) {
		const mapped = toWalletSnapshotRow(row);
		if (mapped) out.push(mapped);
	}
	return out;
};

export async function getNetWorthSummary(tenantId: string): Promise<NetWorthSummary> {
	const result = await db.execute(
		/* sql */ `
      WITH latest AS (
        SELECT
          wallet_id,
          chain,
          MAX(captured_at) AS captured_at
        FROM wallet_snapshots
        WHERE tenant_id = ?
        GROUP BY wallet_id, chain
      )
      SELECT
        ws.wallet_id   AS walletId,
        w.label        AS walletLabel,
        w.address      AS address,
        ws.chain       AS chain,
        ws.payload_json AS payloadJson,
        ws.captured_at AS capturedAt
      FROM wallet_snapshots ws
      JOIN latest l
        ON l.wallet_id = ws.wallet_id
       AND l.chain     = ws.chain
       AND l.captured_at = ws.captured_at
      JOIN wallets w ON w.id = ws.wallet_id
      WHERE ws.tenant_id = ? AND w.tenant_id = ?
    `,
		[tenantId, tenantId, tenantId],
	);

	const rowsRaw = toNetWorthSnapshotRows(result.rows);

	const aggregator = new Map<
		string,
		{
			walletId: string;
			walletLabel: string | null;
			address: string;
			chain: string;
			tokenSymbol: string;
			amount: number;
			usdValue: number;
			capturedAt: string;
		}
	>();

	for (const row of rowsRaw) {
		let tokens: SnapshotTokenEntry[] = [];
		if (row.payloadJson) {
			try {
				const parsed = JSON.parse(row.payloadJson) as SnapshotTokenEntry[];
				if (Array.isArray(parsed)) {
					tokens = parsed;
				}
			} catch (err) {
				console.warn('[networth] failed to parse payload_json', err);
			}
		}

		for (const token of tokens) {
			const symbol = (token.symbol ?? 'UNKNOWN').toUpperCase();
			const key = `${row.walletId}-${row.chain}-${symbol}`;
			const existing = aggregator.get(key) ?? {
				walletId: row.walletId,
				walletLabel: row.walletLabel,
				address: row.address,
				chain: row.chain,
				tokenSymbol: symbol,
				amount: 0,
				usdValue: 0,
				capturedAt: row.capturedAt,
			};

			existing.amount += Number(token.amount ?? 0);
			existing.usdValue += Number(token.valueUsd ?? 0);
			aggregator.set(key, existing);
		}
	}

	const rows: NetWorthRow[] = [];
	let totalSellableUsd = 0;
	let totalCollateralUsd = 0;
	let totalDebtUsd = 0;

	for (const entry of aggregator.values()) {
		totalSellableUsd += entry.usdValue;
		rows.push({
			walletId: entry.walletId,
			walletLabel: entry.walletLabel,
			address: entry.address,
			chain: entry.chain,
			tokenSymbol: entry.tokenSymbol,
			amount: entry.amount.toString(),
			usdValue: entry.usdValue,
			freeUsd: entry.usdValue,
			collateralUsd: 0,
			debtUsd: 0,
			capturedAt: entry.capturedAt,
		});
	}

	return {
		totalUsdValue: totalSellableUsd,
		totalSellableUsd,
		totalCollateralUsd,
		totalDebtUsd,
		rows,
	};
}

export async function getLatestNetWorthSummary(tenantId: string): Promise<LatestNetWorthSummary> {
	console.log('[networth.summary] START');

	const result = await db.execute(
		/* sql */ `
      WITH latest AS (
        SELECT
          wallet_id,
          chain,
          MAX(captured_at) AS captured_at
        FROM wallet_snapshots
        WHERE tenant_id = ?
        GROUP BY wallet_id, chain
      )
      SELECT
        ws.wallet_id AS walletId,
        w.label      AS walletLabel,
        w.address    AS walletAddress,
        ws.chain     AS chain,
        ws.totals_usd AS totalsUsd,
        ws.captured_at AS capturedAt
      FROM wallet_snapshots ws
      JOIN latest l
        ON l.wallet_id = ws.wallet_id
       AND l.chain     = ws.chain
       AND l.captured_at = ws.captured_at
      JOIN wallets w ON w.id = ws.wallet_id
      WHERE ws.tenant_id = ? AND w.tenant_id = ?
    `,
		[tenantId, tenantId, tenantId],
	);

	const rows = toLatestNetWorthRows(result.rows);

	const walletMap = new Map<
		string,
		{
			walletId: string;
			walletLabel: string | null;
			walletAddress: string;
			totalUsd: number;
			byChain: Array<{ chain: string; totalUsd: number; capturedAt: string }>;
		}
	>();
	const chainTotals = new Map<
		string,
		{
			assetsUsd: number;
			freeAssetsUsd: number;
			debtUsd: number;
		}
	>();
	let grandTotal = 0;

	for (const row of rows) {
		const wallet = walletMap.get(row.walletId) ?? {
			walletId: row.walletId,
			walletLabel: row.walletLabel,
			walletAddress: row.walletAddress,
			totalUsd: 0,
			byChain: [],
		};
		wallet.totalUsd += Number(row.totalsUsd ?? 0);
		wallet.byChain.push({
			chain: row.chain,
			totalUsd: Number(row.totalsUsd ?? 0),
			capturedAt: row.capturedAt,
		});
		walletMap.set(row.walletId, wallet);

		const chainSum = chainTotals.get(row.chain) ?? { assetsUsd: 0, freeAssetsUsd: 0, debtUsd: 0 };
		const amount = Number(row.totalsUsd ?? 0);
		chainTotals.set(row.chain, {
			assetsUsd: chainSum.assetsUsd + amount,
			freeAssetsUsd: chainSum.freeAssetsUsd + amount,
			debtUsd: chainSum.debtUsd,
		});
		grandTotal += Number(row.totalsUsd ?? 0);
	}

	console.log('[networth.summary] wallets', Array.from(walletMap.values()).map((w) => ({
		id: w.walletId,
		label: w.walletLabel,
		address: w.walletAddress,
	})));

	const byWalletTotals = await Promise.all(
		Array.from(walletMap.values()).map(async (wallet) => {
			console.log('[networth.summary] computing wallet', {
				walletId: wallet.walletId,
				label: wallet.walletLabel,
			});

			const snapshotAssetsUsd = Number(wallet.totalUsd);
			console.log('[networth] Wallet', wallet.walletId, wallet.walletLabel, 'onchainAssetsUsd=', snapshotAssetsUsd);

			const aaveTotals = await getAaveTotalsForWallet(wallet.walletAddress);
			console.log('[networth] Aave positions result', {
				walletId: wallet.walletId,
				suppliedUsdTotal: (aaveTotals as any).suppliedUsdTotal ?? aaveTotals.suppliedUsd,
				debtUsdTotal: (aaveTotals as any).debtUsdTotal ?? aaveTotals.debtUsd,
				byChainCount: aaveTotals.chains?.length ?? 0,
			});

			const aaveSuppliedTotal = (aaveTotals as any).suppliedUsdTotal ?? aaveTotals.suppliedUsd ?? 0;
			const aaveDebtTotal = (aaveTotals as any).debtUsdTotal ?? aaveTotals.debtUsd ?? 0;

			const assetsUsd = snapshotAssetsUsd + aaveSuppliedTotal;
			const debtUsd = aaveDebtTotal;
			const freeAssetsUsd = assetsUsd - debtUsd;

			console.log('[networth.summary] tokens for wallet', {
				walletId: wallet.walletId,
				count: Array.isArray(wallet.byChain) ? wallet.byChain.length : 0,
				sample: Array.isArray(wallet.byChain) ? wallet.byChain[0] : null,
			});

			const chainRows = [
				...wallet.byChain.map((chain) => ({
					...chain,
					assetsUsd: Number(chain.totalUsd ?? 0),
					freeAssetsUsd: Number(chain.totalUsd ?? 0),
					debtUsd: 0,
				})),
				...aaveTotals.chains.map((chain) => ({
					chain: chain.chain,
					totalUsd: Number(chain.suppliedUsd ?? 0),
					assetsUsd: Number(chain.suppliedUsd ?? 0),
					freeAssetsUsd: 0,
					debtUsd: Number(chain.debtUsd ?? 0),
					capturedAt: new Date().toISOString(),
				})),
			];

			for (const chain of aaveTotals.chains) {
				const prev = chainTotals.get(chain.chain) ?? { assetsUsd: 0, freeAssetsUsd: 0, debtUsd: 0 };
				chainTotals.set(chain.chain, {
					assetsUsd: prev.assetsUsd + Number(chain.suppliedUsd ?? 0),
					freeAssetsUsd: prev.freeAssetsUsd,
					debtUsd: prev.debtUsd + Number(chain.debtUsd ?? 0),
				});
			}

			console.log('[networth.summary] wallet result', {
				walletId: wallet.walletId,
				assetsUsd,
				freeAssetsUsd,
				debtUsd,
				totalUsd: assetsUsd - debtUsd,
			});
			console.log('[networth] Wallet summary', {
				walletId: wallet.walletId,
				address: wallet.walletAddress,
				snapshotAssetsUsd,
				aaveSuppliedUsd: aaveSuppliedTotal,
				aaveDebtUsd: aaveDebtTotal,
				assetsUsd,
				debtUsd,
				netUsd: assetsUsd - debtUsd,
			});
			return {
				walletId: wallet.walletId,
				walletLabel: wallet.walletLabel,
				walletAddress: wallet.walletAddress,
				totalUsd: assetsUsd,
				byChain: chainRows,
				assetsUsd,
				freeAssetsUsd,
				debtUsd,
			};
		}),
	);

	const byChainTotals = Array.from(chainTotals.entries()).map(([chain, totals]) => {
		return {
			chain,
			totalUsd: Number(totals.assetsUsd ?? 0),
			assetsUsd: Number(totals.assetsUsd ?? 0),
			freeAssetsUsd: Number(totals.freeAssetsUsd ?? 0),
			debtUsd: Number(totals.debtUsd ?? 0),
		};
	});

	const totalAssetsUsd = byWalletTotals.reduce((acc, wallet) => acc + Number(wallet.assetsUsd ?? 0), 0);
	const totalFreeAssetsUsd = byWalletTotals.reduce((acc, wallet) => acc + Number(wallet.freeAssetsUsd ?? 0), 0);
	const totalDebtUsd = byWalletTotals.reduce((acc, wallet) => acc + Number(wallet.debtUsd ?? 0), 0);

	const aaveIncluded = byWalletTotals.some(
		(wallet) => Number(wallet.assetsUsd ?? 0) !== Number(wallet.freeAssetsUsd ?? 0) || Number(wallet.debtUsd ?? 0) > 0,
	);

	console.log('[networth] Totals', { totalAssetsUsd, totalFreeAssetsUsd, totalDebtUsd });

	console.log('[networth.summary] FINAL', {
		totalAssetsUsd,
		totalFreeAssetsUsd,
		totalDebtUsd,
		walletCount: byWalletTotals.length,
		aaveIncluded: aaveIncluded,
	});

	const tins = byWalletTotals.map((wallet) => ({
		tinId: wallet.walletId,
		tinName: wallet.walletLabel,
		assetsUsd: wallet.assetsUsd,
		freeAssetsUsd: wallet.freeAssetsUsd,
		debtUsd: wallet.debtUsd,
		netUsd: wallet.assetsUsd - wallet.debtUsd,
	}));

	return {
		totalUsd: totalAssetsUsd,
		byWallet: byWalletTotals,
		byChain: byChainTotals,
		totalAssetsUsd,
		totalFreeAssetsUsd,
		totalDebtUsd,
		tins,
		aaveIncluded,
	};
}

/**
 * Placeholder for Aave net worth per wallet.
 * Replace with real integration when available.
 */
export async function getAaveNetWorthForWallet(
	_walletId: string,
): Promise<{ suppliedUsd: number; debtUsd: number }> {
	return { suppliedUsd: 0, debtUsd: 0 };
}

export type SnapshotTokenEntry = {
	symbol: string;
	amount: number;
	priceUsd: number | null;
	valueUsd: number | null;
	tokenAddress: string | null;
};

export type SnapshotToken = {
	chain: string;
	tokenAddress: string;
	symbol: string;
	balance: string;
	usdValue: number;
	source: 'onchain' | 'aave';
};

export type SnapshotValueBreakdown = {
	tenantId: string;
	walletId: string;
	chain: SupportedChain;
	totalUsd?: number;
	tokens: Array<SnapshotToken | SnapshotTokenEntry>;
};

export async function getLatestSnapshotCapturedAtByChain(tenantId: string): Promise<Map<string, string>> {
	const result = await db.execute({
		sql: `SELECT chain, MAX(captured_at) AS captured_at
			FROM wallet_snapshots
			WHERE tenant_id = ?
			GROUP BY chain`,
		args: [tenantId],
	});
	const map = new Map<string, string>();
	for (const row of result.rows ?? []) {
		const chain = String((row as any).chain ?? '');
		const capturedAt = (row as any).captured_at ?? null;
		if (chain && capturedAt) {
			map.set(chain, String(capturedAt));
		}
	}
	return map;
}

export async function insertWalletSnapshotFromValueBreakdown(breakdown: SnapshotValueBreakdown) {
	// Normalize tokens to ensure missing prices/values are stored as null (never zero).
	const normalizedTokens = (breakdown.tokens ?? []).map((token) => {
		if ('priceUsd' in token || 'valueUsd' in token) {
			const price = Number((token as SnapshotTokenEntry).priceUsd ?? 0);
			const value = Number((token as SnapshotTokenEntry).valueUsd ?? 0);
			return {
				...token,
				priceUsd: Number.isFinite(price) && price > 0 ? price : null,
				valueUsd: Number.isFinite(value) && value > 0 ? value : null,
			} as SnapshotTokenEntry;
		}
		return token;
	});

	// Compute totalUsd from tokens to avoid stale values.
	const computedTotalUsd = normalizedTokens.reduce((sum, token) => {
		const usdVal =
			'usdValue' in token
				? Number((token as SnapshotToken).usdValue ?? 0)
				: Number((token as SnapshotTokenEntry).valueUsd ?? 0);
		return sum + usdVal;
	}, 0);
	const totalUsd = Number.isFinite(computedTotalUsd) ? computedTotalUsd : Number(breakdown.totalUsd ?? 0);

	const payloadJson = JSON.stringify(normalizedTokens);
	console.log('[snapshot job] about to insert snapshot', {
		walletId: breakdown.walletId,
		chain: breakdown.chain,
		tokenCount: breakdown.tokens?.length ?? 0,
		totalUsd,
		payload_json: payloadJson,
	});

	const result = await db.execute({
		sql: `INSERT INTO wallet_snapshots (
				tenant_id,
				wallet_id,
				chain,
				totals_usd,
				collateral_usd,
				debt_usd,
				collateral_apy_pct,
				borrow_apy_pct,
				net_rate_pct,
				payload_json,
				captured_at
			)
			VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
		args: [
			breakdown.tenantId,
			breakdown.walletId,
			breakdown.chain,
			totalUsd,
			payloadJson,
		],
	});

	console.log('[snapshot job] inserted snapshot row result', result);

	// Reprice later if any token lacks a valid price/value (avoid zero poisoning).
	const hasMissingPrices = normalizedTokens.some((token) => {
		if (!('priceUsd' in token || 'valueUsd' in token)) return false;
		const amount =
			'balance' in token
				? Number((token as SnapshotToken).balance ?? 0)
				: Number((token as SnapshotTokenEntry).amount ?? 0);
		if (!Number.isFinite(amount) || amount <= 0) return false;
		const price =
			'priceUsd' in token ? Number((token as SnapshotTokenEntry).priceUsd ?? 0) : null;
		const value =
			'valueUsd' in token
				? Number((token as SnapshotTokenEntry).valueUsd ?? 0)
				: Number((token as SnapshotToken).usdValue ?? 0);
		const priceMissing = price === null || !Number.isFinite(price) || price <= 0;
		const valueMissing = !Number.isFinite(value) || value <= 0;
		return priceMissing || valueMissing;
	});

	if (hasMissingPrices) {
		void repriceMissingWalletTokens({
			tenantId: breakdown.tenantId,
			walletId: breakdown.walletId,
			trigger: 'snapshot-insert',
		}).catch((error) => {
			console.warn('[snapshot job] reprice failed', {
				walletId: breakdown.walletId,
				tenantId: breakdown.tenantId,
				error,
			});
		});
	}
}

export type WalletTokenRow = {
	tokenSymbol: string;
	chain: string;
	amount: number;
	usdValue: number;
	capturedAt?: string | null;
	priceUsd?: number | null;
	purchaseAt?: string | null;
	purchasePriceUsd?: number | null;
};

class WalletTokenBreakdownError extends Error {
	status: number;
	code: string;
	details?: Record<string, unknown>;

	constructor(message: string, status = 500, code = 'TOKEN_BREAKDOWN_ERROR', details?: Record<string, unknown>) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

export type WalletTokenResult = {
	walletId: string;
	address: string;
	label: string | null;
	snapshots: Array<{ id: string; chain: string; capturedAt: string; tokenCount: number }>;
	tokens: WalletTokenRow[];
};

export async function getWalletTokenBreakdown(tenantId: string, walletId: string): Promise<WalletTokenResult> {
	const startedAt = Date.now();
	console.log('[networth.getWalletTokenBreakdown] START', { walletId });
	console.log('[getWalletTokenBreakdown] called for walletId', walletId);

	if (!walletId) {
		throw new WalletTokenBreakdownError('Missing wallet id', 400, 'MISSING_WALLET_ID');
	}

	const walletResult = await db.execute({
		sql: 'SELECT id, address, label FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
		args: [walletId, tenantId],
	});
	const wallet = toWalletRow(walletResult.rows[0]) ?? undefined;

	console.log('[networth.getWalletTokenBreakdown] Wallet row', {
		walletId,
		address: wallet?.address,
		label: wallet?.label,
	});

	if (!wallet) {
		console.warn('[networth.getWalletTokenBreakdown] No wallet found', { walletId });
		throw new WalletTokenBreakdownError('Wallet not found', 404, 'WALLET_NOT_FOUND', { walletId });
	}

	const result = await db.execute(
		/* sql */ `
      WITH ranked AS (
        SELECT
          ws.id           AS id,
          ws.chain        AS chain,
          ws.payload_json AS payloadJson,
          ws.captured_at  AS capturedAt,
          ws.totals_usd   AS totalsUsd,
          ROW_NUMBER() OVER (
            PARTITION BY ws.chain
            ORDER BY ws.captured_at DESC, ws.id DESC
          ) AS rn
        FROM wallet_snapshots ws
        WHERE ws.wallet_id = ? AND ws.tenant_id = ?
      )
      SELECT
        id,
        chain,
        payloadJson,
        capturedAt,
        totalsUsd
      FROM ranked
      WHERE rn = 1
    `,
		[walletId, tenantId],
	);

	const rows = toWalletSnapshotRows(result.rows);
	const hasNonEmptyPayload = rows.some((row) => {
		try {
			const parsed = JSON.parse(row.payloadJson ?? '[]');
			return Array.isArray(parsed) && parsed.length > 0;
		} catch {
			return false;
		}
	});
	console.log('[wallet.tokens] snapshot payload summary', {
		walletId,
		rowCount: rows.length,
		hasNonEmptyPayload,
	});
	if (!rows.length) {
		throw new WalletTokenBreakdownError('No snapshots found for wallet', 404, 'NO_SNAPSHOTS', {
			walletId,
			address: wallet.address,
		});
	}
	console.log('[getWalletTokenBreakdown] snapshot rows', {
		walletId,
		count: rows.length,
		rows: rows.map((r) => ({ id: r.id, chain: r.chain, capturedAt: r.capturedAt })),
	});
	const accumulator = new Map<string, WalletTokenRow>();
	const allowedSymbols = new Set(['ETH', 'WBTC', 'LINK', 'POL', 'AVAX']);
	const allowedChains = new Set(['ethereum', 'polygon', 'avalanche']);

	function normalizeSymbol(symbol: string) {
		const upper = symbol.toUpperCase();
		if (upper === 'MATIC') return 'POL';
		return upper;
	}

	function normalizeChain(chain: string) {
		const lower = chain.toLowerCase();
		if (lower.includes('polygon') || lower.includes('matic')) return 'polygon';
		if (lower.includes('avax') || lower.includes('avalanche')) return 'avalanche';
		if (lower.includes('eth')) return 'ethereum';
		return lower;
	}

	for (const row of rows) {
		console.log('[tokens API] row', {
			id: row.id,
			chain: row.chain,
			captured_at: row.capturedAt,
			payload_json: row.payloadJson,
		});

		if (!row.payloadJson) {
			console.warn('[getWalletTokenBreakdown] snapshot payload_json empty', {
				walletId,
				rowId: row.id,
				chain: row.chain,
			});
			continue;
		}
		let tokens: Array<SnapshotToken | SnapshotTokenEntry> = [];

		try {
			const parsed = JSON.parse(row.payloadJson) as Array<SnapshotToken | SnapshotTokenEntry>;
			if (Array.isArray(parsed)) {
				tokens = parsed;
			}
		} catch (err) {
			console.warn('[getWalletTokenBreakdown] failed to parse payloadJson', err);
			continue;
		}

		const firstToken = Array.isArray(tokens) && tokens.length ? tokens[0] : null;
		const firstTokenSummary = firstToken
			? {
					symbol: (firstToken as any).symbol ?? (firstToken as any).tokenSymbol ?? null,
					amount: (firstToken as any).amount ?? (firstToken as any).balance ?? null,
					priceUsd: (firstToken as any).priceUsd ?? null,
					valueUsd: (firstToken as any).valueUsd ?? (firstToken as any).usdValue ?? null,
			  }
			: null;
		console.log(
			`[tokens.read] walletId=${walletId} chain=${row.chain} snapshotId=${row.id} capturedAt=${row.capturedAt} totalsUsd=${row.totalsUsd ?? 'null'} firstToken=${JSON.stringify(firstTokenSummary)}`,
		);
		console.log('[tokens API] parsed tokens for row', row.id, tokens);

		for (const token of tokens) {
			const tokenSymbol = normalizeSymbol(((token as any).symbol ?? 'UNKNOWN').toUpperCase());
			const tokenChain = normalizeChain(String((token as any).chain ?? row.chain ?? ''));
			const tokenSource = String((token as any).source ?? '').toLowerCase();
			if (tokenSource === 'aave' || tokenSource === 'defi') {
				continue;
			}
			const amount =
				'balance' in token
					? Number((token as SnapshotToken).balance ?? 0)
					: Number((token as SnapshotTokenEntry).amount ?? 0);
			const usdValue =
				'usdValue' in token
					? Number((token as SnapshotToken).usdValue ?? 0)
					: Number((token as SnapshotTokenEntry).valueUsd ?? 0);

			if (!allowedSymbols.has(tokenSymbol) || !allowedChains.has(tokenChain)) {
				continue;
			}

			const normalizedAmount = Number.isFinite(amount) ? amount : 0;
			const normalizedUsd = Number.isFinite(usdValue) ? usdValue : 0;

			if (normalizedAmount <= 0 && normalizedUsd <= 0) {
				continue;
			}

			const key = `${tokenChain}::${tokenSymbol}`;

			const priceFromToken =
				'priceUsd' in token ? Number((token as SnapshotTokenEntry).priceUsd ?? 0) : normalizedUsd / normalizedAmount;
			const normalizedPrice = Number.isFinite(priceFromToken) && normalizedAmount > 0 ? priceFromToken : 0;

			const existing = accumulator.get(key) ?? {
				tokenSymbol,
				chain: tokenChain,
				amount: 0,
				usdValue: 0,
				capturedAt: row.capturedAt,
				priceUsd: normalizedPrice || null,
			};

			existing.amount += normalizedAmount;
			existing.usdValue += normalizedUsd;
			if (!existing.capturedAt) {
				existing.capturedAt = row.capturedAt;
			}
			if (!existing.priceUsd && normalizedPrice) {
				existing.priceUsd = normalizedPrice;
			}
			accumulator.set(key, existing);
		}
	}

	const tokens = Array.from(accumulator.values());

	console.log('[networth.getWalletTokenBreakdown] RESULT', {
		walletId,
		address: wallet.address,
		count: Array.isArray(tokens) ? tokens.length : 0,
		sample: Array.isArray(tokens) ? tokens[0] : tokens,
		elapsedMs: Date.now() - startedAt,
	});
	console.log('[getWalletTokenBreakdown] final tokens', tokens);
	if (!tokens.length) {
		console.warn('[wallet.tokens] No tokens after parsing snapshots', { walletId, rowCount: rows.length });
	}

	if (!tokens.length && !hasNonEmptyPayload) {
		throw new WalletTokenBreakdownError('Snapshots contained no token data', 404, 'EMPTY_SNAPSHOTS', {
			walletId,
			snapshotCount: rows.length,
		});
	}

	return {
		walletId: wallet.id ?? walletId,
		address: wallet.address ?? '',
		label: wallet.label ?? null,
		snapshots: rows.map((row) => ({
			id: row.id,
			chain: row.chain,
			capturedAt: row.capturedAt,
			tokenCount: (() => {
				try {
					const parsed = JSON.parse(row.payloadJson ?? '[]');
					return Array.isArray(parsed) ? parsed.length : 0;
				} catch {
					return 0;
				}
			})(),
		})),
		tokens,
	};
}
