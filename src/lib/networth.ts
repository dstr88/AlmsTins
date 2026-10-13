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
	/** Total count of all tins: on-chain wallets + exchange accounts + custom wallets */
	tinCount?: number;
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
        ws.wallet_id   AS "walletId",
        w.label        AS "walletLabel",
        w.address      AS address,
        ws.chain       AS chain,
        ws.payload_json AS "payloadJson",
        ws.captured_at AS "capturedAt"
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
        ws.wallet_id AS "walletId",
        w.label      AS "walletLabel",
        w.address    AS "walletAddress",
        ws.chain     AS chain,
        ws.totals_usd AS "totalsUsd",
        ws.captured_at AS "capturedAt"
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

	// Count all tins: on-chain wallets + custom wallets + exchange accounts
	const [walletCountResult, exchangeCountResult] = await Promise.all([
		db.execute({ sql: 'SELECT COUNT(*) as count FROM wallets WHERE tenant_id = ?', args: [tenantId] }),
		db.execute({ sql: 'SELECT COUNT(*) as count FROM exchange_accounts WHERE tenant_id = ?', args: [tenantId] }),
	]);
	const tinCount =
		Number(walletCountResult.rows[0]?.count ?? 0) +
		Number(exchangeCountResult.rows[0]?.count ?? 0);

	return {
		totalUsd: totalAssetsUsd,
		byWallet: byWalletTotals,
		byChain: byChainTotals,
		totalAssetsUsd,
		totalFreeAssetsUsd,
		totalDebtUsd,
		tins,
		tinCount,
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
	unpricedReason?: string | null;
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
			VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`,
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
	usdValue: number | null;
	capturedAt?: string | null;
	priceUsd?: number | null;
	unpricedReason?: string | null;
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
          ws.payload_json AS "payloadJson",
          ws.captured_at  AS "capturedAt",
          ws.totals_usd   AS "totalsUsd",
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
        "payloadJson",
        "capturedAt",
        "totalsUsd"
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
	const allowedSymbols = new Set([
		'ETH',
		'WETH',
		'WBTC',
		'BTC',
		'LTC',
		'LINK',
		'POL',
		'MATIC',
		'WMATIC',
		'AVAX',
		'USDC',
		'USDT',
		'AAVE',
		'ARB',
		'STETH',
		'WSTETH',
		'QUICK',
		'SOL',
		'SUI',
		'PYTH',
		'BONK',
		'JTO',
		'MSOL',
		'BSOL',
		'WSOL',
		// Rootstock / Sovryn
		'RBTC',
		'WRBTC',
		'SOV',
		'XUSD',
		'BPRO',
		'RIF',
		'RUSDT',
		'DLLR',
		'ZUSD',
		'MOC',
		'FISH',
	]);
	const VERIFIED_CONTRACTS_BY_CHAIN: Record<string, Record<string, Set<string>>> = {
		ethereum: {
			WETH: new Set(['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2']),
			USDC: new Set(['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48']),
			USDT: new Set(['0xdac17f958d2ee523a2206206994597c13d831ec7']),
			WBTC: new Set(['0x2260fac5e5542a773aa44fbcfedf7c193bc2c599']),
			LINK: new Set(['0x514910771af9ca656af840dff83e8264ecf986ca']),
			AAVE: new Set(['0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9']),
			STETH: new Set(['0xae7ab96520de3a18e5e111b5eaab095312d7fe84']),
			WSTETH: new Set(['0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0']),
		},
		polygon: {
			WMATIC: new Set(['0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270']),
			USDC: new Set([
				'0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
				'0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
			]),
			USDT: new Set(['0xc2132d05d31c914a87c6611c10748aeb04b58e8f']),
			WBTC: new Set(['0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6']),
			LINK: new Set(['0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39']),
			AAVE: new Set(['0xd6df932a45c0f255f85145f286ea0b292b21c90b']),
			QUICK: new Set([
				'0x831753dd7087cac61ab5644b308642cc1c33dc13',
				'0xb5c064f955d8e7f38fe0460c556a72987494ee17',
			]),
		},
		avalanche: {
			// Native AAVE bridged to Avalanche C-Chain via the official Aave bridge
			AAVE: new Set(['0x63a72806098bd3d9520cc43356dd78afe5d386d9']),
			// Avalanche USDC (native) and bridged
			USDC: new Set([
				'0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', // native USDC on Avalanche
				'0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664', // USDC.e (bridged)
			]),
			USDT: new Set(['0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7']), // native USDT on Avalanche
			WBTC: new Set(['0x50b7545627a5162f82a992c33b87adc75187b218']),
			LINK: new Set(['0x5947bb275c521040051d82396192181b413227a3']),
		},
		rootstock: {
			SOV:   new Set(['0xefc78fc7d48b64958315949279ba181c2114abbd']),
			XUSD:  new Set(['0xb5999795be0ebb5bab23144aa5fd6a02d080299e']),
			BPRO:  new Set(['0x440cd83c160de5c96ddb20246815ea44c7abbca8']),
			RIF:   new Set(['0x2acc95758f8b5f583470ba265eb685a8f45fc9d5']),
			RUSDT: new Set(['0xef213441a85df4d7acbdae0cf78004e1e486bb96']),
			DLLR:  new Set(['0xc1411567d2670e24d9bda715a9b74b40e20e3ee2']),
			ZUSD:  new Set(['0xdb107fa69e33f05180a4c2cce9c2e7cb481645c2d']),
			WRBTC: new Set(['0x542fda317318ebf1d3deaf76e0b632741a7e677d']),
			MOC:   new Set(['0x9ac7fe28967b30e3a4e6e03286d715b42b453d10']),
			FISH:  new Set(['0x055a902303746382fbb7d18f6ae0df56efdc5213']),
		},
	};
	const allowedChains = new Set(['ethereum', 'polygon', 'avalanche', 'solana', 'sui', 'rootstock', 'bitcoin', 'litecoin']);

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
		if (lower === 'solana' || lower.includes('sol-mainnet')) return 'solana';
		if (lower === 'sui') return 'sui';
		if (lower === 'rootstock' || lower === 'rsk') return 'rootstock';
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

		if (!(globalThis as any).unverifiedLogCount) {
			(globalThis as any).unverifiedLogCount = 0;
		}
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
			const tokenAddress = String(
				(token as any).tokenAddress ?? (token as any).contractAddress ?? '',
			)
				.trim()
				.toLowerCase();
			const isNative = !tokenAddress || tokenAddress === 'native';

			if (!allowedSymbols.has(tokenSymbol) || !allowedChains.has(tokenChain)) {
				continue;
			}

			const normalizedAmount = Number.isFinite(amount) ? amount : 0;
			let normalizedUsd: number | null = Number.isFinite(usdValue) ? usdValue : null;
			let unpricedReason: string | null = null;

			if (!isNative) {
				const verifiedSet = VERIFIED_CONTRACTS_BY_CHAIN[tokenChain]?.[tokenSymbol];
				if (
					tokenSymbol !== 'ETH' &&
					tokenSymbol !== 'MATIC' &&
					tokenSymbol !== 'WMATIC' &&
					tokenSymbol !== 'POL' &&
					verifiedSet &&
					!verifiedSet.has(tokenAddress.toLowerCase())
				) {
					unpricedReason = 'unverified_contract';
					normalizedUsd = null;
					if (import.meta.env.WALLET_DEBUG === '1' && (globalThis as any).unverifiedLogCount < 20) {
						(globalThis as any).unverifiedLogCount += 1;
						console.log('[pricing] unverified contract', {
							walletId,
							chain: tokenChain,
							symbol: tokenSymbol,
							contract: tokenAddress,
							reason: unpricedReason,
						});
					}
				}
				if (import.meta.env.WALLET_DEBUG === '1') {
					const hasSet = Boolean(verifiedSet);
					const match = Boolean(verifiedSet && tokenAddress && verifiedSet.has(tokenAddress.toLowerCase()));
					console.log('[pricing] verify', {
						walletId,
						chain: tokenChain,
						symbol: tokenSymbol,
						contract: tokenAddress,
						hasSet,
						match,
						usdValue: normalizedUsd,
						unpricedReason,
					});
				}
			}

			// Apply fallback prices for known symbols when the live price is missing (null or 0).
			// "=== 0" is treated the same as null — a zero stored price means the lookup failed.
			if ((normalizedUsd === null || normalizedUsd === 0) && Number.isFinite(normalizedAmount) && normalizedAmount > 0) {
				let fallbackPrice: number | null = null;
				if (tokenSymbol === 'WBTC') fallbackPrice = 70000;
				if (tokenSymbol === 'LINK') fallbackPrice = 8.85;
				if (tokenSymbol === 'AAVE') fallbackPrice = 150; // updated Apr 2026; refresh via reprice job
				if (tokenSymbol === 'WMATIC') fallbackPrice = 0.095;
				if (tokenSymbol === 'SOL' || tokenSymbol === 'WSOL' || tokenSymbol === 'MSOL' || tokenSymbol === 'BSOL') fallbackPrice = 135; // updated Apr 2026
				if (tokenSymbol === 'SUI')  fallbackPrice = 2.2;   // updated Apr 2026
				if (tokenSymbol === 'PYTH') fallbackPrice = 0.25;  // updated Apr 2026
				if (tokenSymbol === 'JTO')  fallbackPrice = 1.80;  // updated Apr 2026
				if (tokenSymbol === 'BONK') fallbackPrice = 0.000018; // updated Apr 2026
				if (tokenSymbol === 'BTC')  fallbackPrice = 95000; // updated Jun 2026
				if (tokenSymbol === 'LTC')  fallbackPrice = 90;    // updated Jun 2026
				// Rootstock / Sovryn fallbacks
				if (tokenSymbol === 'RBTC' || tokenSymbol === 'WRBTC') fallbackPrice = 85000; // ~BTC price Apr 2026
				if (tokenSymbol === 'SOV')   fallbackPrice = 0.45;   // updated Apr 2026
				if (tokenSymbol === 'BPRO')  fallbackPrice = 85000;  // BitPRO backed by BTC
				if (tokenSymbol === 'RIF')   fallbackPrice = 0.08;   // updated Apr 2026
				if (tokenSymbol === 'XUSD' || tokenSymbol === 'RUSDT' || tokenSymbol === 'DLLR' || tokenSymbol === 'ZUSD') fallbackPrice = 1.00;
				if (tokenSymbol === 'MOC')   fallbackPrice = 0.40;   // updated Apr 2026
				if (tokenSymbol === 'FISH')  fallbackPrice = 0.002;  // updated Apr 2026
				if (fallbackPrice) {
					normalizedUsd = fallbackPrice * normalizedAmount;
					if (import.meta.env.WALLET_DEBUG === '1') {
						console.log('[pricing] fallback price', {
							walletId,
							chain: tokenChain,
							symbol: tokenSymbol,
							contract: tokenAddress,
							fallbackPrice,
							usdValue: normalizedUsd,
						});
					}
				} else if (import.meta.env.WALLET_DEBUG === '1') {
					console.log('[pricing] missing upstream price', {
						walletId,
						chain: tokenChain,
						symbol: tokenSymbol,
						contract: tokenAddress,
					});
				}
			}

			if (normalizedAmount <= 0 && (!Number.isFinite(normalizedUsd ?? NaN) || (normalizedUsd ?? 0) <= 0)) {
				continue;
			}

			const key = `${tokenChain}::${tokenSymbol}`;

			const priceFromToken =
				'priceUsd' in token
					? Number((token as SnapshotTokenEntry).priceUsd ?? 0)
					: normalizedUsd === null
						? 0
						: normalizedUsd / normalizedAmount;
			const normalizedPrice = Number.isFinite(priceFromToken) && normalizedAmount > 0 ? priceFromToken : 0;

			const existing = accumulator.get(key) ?? {
				tokenSymbol,
				chain: tokenChain,
				amount: 0,
				usdValue: null,
				capturedAt: row.capturedAt,
				priceUsd: normalizedPrice || null,
				unpricedReason: null,
			};

			existing.amount += normalizedAmount;
			if (normalizedUsd !== null) {
				existing.usdValue = (existing.usdValue ?? 0) + normalizedUsd;
			}
			if (!existing.capturedAt) {
				existing.capturedAt = row.capturedAt;
			}
			if (unpricedReason) {
				existing.priceUsd = null;
				existing.unpricedReason = unpricedReason;
			} else if (!existing.priceUsd && normalizedPrice) {
				existing.priceUsd = normalizedPrice;
			}
			accumulator.set(key, existing);
		}
	}

	const tokens = Array.from(accumulator.values());

	// Enrich each token with the earliest import_transactions date (for Days column)
	// and average cost basis price (for P/L column).
	//
	// Only genuine acquisitions are considered for the earliest-date calculation:
	//   • direction must be 'in'  (skip sells / withdrawals)
	//   • kind must not be a sell_lock / sell_unlock (cancelled limit orders return
	//     coins to the account but should not reset the holding-period clock)
	//   • staking income is excluded (ordinary income, not a new cost basis event)
	if (tokens.length > 0) {
		const symbols = [...new Set(tokens.map((t) => t.tokenSymbol.toUpperCase()))];
		const placeholders = symbols.map(() => '?').join(', ');
		try {
			const enrichResult = await db.execute({
				sql: `SELECT
				        upper(asset_symbol) AS symbol,
				        MIN(CASE
				          WHEN direction = 'in'
				           AND (kind IS NULL
				                OR (lower(kind) NOT LIKE '%sell_lock%'
				                    AND lower(kind) NOT LIKE '%sell_unlock%'
				                    AND lower(kind) != 'staking income'))
				          THEN timestamp_utc
				        END)                                           AS earliest,
				        SUM(CASE
				          WHEN direction = 'in' AND amount > 0
				           AND (kind IS NULL
				                OR (lower(kind) NOT LIKE '%sell_lock%'
				                    AND lower(kind) NOT LIKE '%sell_unlock%'
				                    AND lower(kind) != 'staking income'))
				          THEN ABS(COALESCE(native_usd, 0)) ELSE 0
				        END)                                           AS total_cost,
				        SUM(CASE
				          WHEN direction = 'in' AND amount > 0
				           AND (kind IS NULL
				                OR (lower(kind) NOT LIKE '%sell_lock%'
				                    AND lower(kind) NOT LIKE '%sell_unlock%'
				                    AND lower(kind) != 'staking income'))
				          THEN ABS(amount) ELSE 0
				        END)                                           AS total_qty
				      FROM import_transactions
				      WHERE tenant_id = ?
				        AND asset_symbol IS NOT NULL
				        AND upper(asset_symbol) IN (${placeholders})
				      GROUP BY upper(asset_symbol)`,
				args: [tenantId, ...symbols],
			});
			for (const eRow of enrichResult.rows) {
				const sym = String(eRow.symbol ?? '').toUpperCase();
				const earliest = eRow.earliest ? String(eRow.earliest) : null;
				const totalCost = typeof eRow.total_cost === 'number' ? eRow.total_cost : Number(eRow.total_cost ?? 0);
				const totalQty  = typeof eRow.total_qty  === 'number' ? eRow.total_qty  : Number(eRow.total_qty  ?? 0);
				const avgPrice  = totalQty > 0 && totalCost > 0 ? totalCost / totalQty : null;

				for (const token of tokens) {
					if (token.tokenSymbol.toUpperCase() !== sym) continue;
					if (earliest) token.purchaseAt = earliest;
					if (avgPrice !== null && Number.isFinite(avgPrice)) token.purchasePriceUsd = avgPrice;
				}
			}
		} catch {
			// non-fatal — purchaseAt / purchasePriceUsd remain undefined
		}

		// Second pass: fill purchaseAt from on-chain transactions table for tokens
		// that had no import_transactions entry (e.g. Alchemy-snapshotted ERC-20s).
		//
		// tx_type values used by scanSync.ts:
		//   'incoming'  — native coin received  (ETH/POL/AVAX stored as token_symbol='native')
		//   'token_in'  — ERC-20 token received  (stored with its actual symbol)
		//
		// Native coins are stored with token_symbol='native' so we map them back via
		// a CASE on the chain column before comparing against the symbol list.
		const missingPurchaseAt = tokens.filter((t) => !t.purchaseAt);
		if (missingPurchaseAt.length > 0) {
			try {
				const syms2 = [...new Set(missingPurchaseAt.map((t) => t.tokenSymbol.toUpperCase()))];
				const ph2 = syms2.map(() => '?').join(', ');
				const onchainResult = await db.execute({
					sql: `SELECT symbol, MIN(earliest) AS earliest FROM (
					        SELECT
					          CASE
					            WHEN lower(token_symbol) = 'native' AND lower(chain) = 'ethereum'            THEN 'ETH'
					            WHEN lower(token_symbol) = 'native' AND lower(chain) IN ('polygon','matic')  THEN 'POL'
					            WHEN lower(token_symbol) = 'native' AND lower(chain) = 'avalanche'           THEN 'AVAX'
					            WHEN lower(token_symbol) = 'native' AND lower(chain) = 'bitcoin'             THEN 'BTC'
					            WHEN lower(token_symbol) = 'native' AND lower(chain) = 'solana'              THEN 'SOL'
					            WHEN lower(token_symbol) = 'native' AND lower(chain) = 'sui'                 THEN 'SUI'
					            ELSE upper(token_symbol)
					          END AS symbol,
					          timestamp AS earliest
					        FROM transactions
					        WHERE tenant_id = ?
					          AND wallet_id  = ?
					          AND tx_type IN ('incoming', 'token_in')
					          AND token_symbol IS NOT NULL
					      ) sub
					      WHERE symbol IN (${ph2})
					      GROUP BY symbol`,
					args: [tenantId, walletId, ...syms2],
				});
				for (const oRow of onchainResult.rows) {
					const sym = String(oRow.symbol ?? '').toUpperCase();
					const earliest = oRow.earliest ? String(oRow.earliest) : null;
					if (!earliest) continue;
					for (const token of tokens) {
						if (token.tokenSymbol.toUpperCase() !== sym) continue;
						if (!token.purchaseAt) token.purchaseAt = earliest;
					}
				}
			} catch {
				// non-fatal
			}
		}
	}

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
