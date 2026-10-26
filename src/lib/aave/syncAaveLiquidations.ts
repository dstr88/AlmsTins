import { db } from '@/lib/db';
import { sendMail } from '@/lib/email';
import { insertImportBatch, type ImportTxRow } from '@/lib/importRows';
import { isLang } from '@/lib/i18n/locale';
import { ensureUserLangColumn } from '@/lib/i18n/userLang';
import { getLiquidationAlert } from '@/i18n/emails/liquidationAlert';
import { AAVE_CHAIN_BY_ID, AAVE_CHAIN_IDS, AAVE_POOL_BY_CHAIN_ID } from '@/lib/chains';

const AAVE_GRAPHQL_ENDPOINT = 'https://api.v3.aave.com/graphql';
// The Aave V3 markets, from src/lib/chains.ts.
const CHAIN_IDS = AAVE_CHAIN_IDS;
const CHAIN_KEYS = AAVE_CHAIN_BY_ID;
const MARKET_ADDRESSES = AAVE_POOL_BY_CHAIN_ID;

const LIQUIDATION_QUERY = `
  query UserLiquidations($request: UserTransactionHistoryRequest!) {
    userTransactionHistory(request: $request) {
      items {
        __typename
        ... on UserLiquidationCallTransaction {
          txHash
          timestamp
          blockExplorerUrl
          collateral {
            amount { amount { value decimals } usd usdPerToken }
            reserve { underlyingToken { symbol address } }
          }
          debtRepaid {
            amount { amount { value decimals } usd }
            reserve { underlyingToken { symbol } }
          }
        }
      }
      pageInfo { next }
    }
  }
`;

export type AaveLiquidation = {
	txHash: string;
	timestamp: string;
	blockExplorerUrl: string;
	chain: string;
	collateralSymbol: string;
	collateralAmount: number;
	collateralUsd: number;
	debtSymbol: string;
	debtAmount: number;
	debtUsd: number;
	penaltyUsd: number;
};

function rawToDecimal(value: string, decimals: number): number {
	try {
		const raw = BigInt(value);
		const div = BigInt(10 ** Math.min(decimals, 18));
		const whole = Number(raw / div);
		const frac = Number(raw % div) / Math.pow(10, Math.min(decimals, 18));
		return whole + frac;
	} catch {
		return 0;
	}
}

function toTimestampIso(value: unknown): string {
	if (typeof value === 'number') return new Date(value * 1000).toISOString();
	if (typeof value === 'string') {
		// ISO string already
		if (value.includes('T') || value.includes('-')) return value;
		// Unix timestamp as string
		const n = Number(value);
		if (Number.isFinite(n)) return new Date(n * 1000).toISOString();
	}
	return new Date().toISOString();
}

async function postGraphQL(query: string, variables: Record<string, unknown>, timeoutMs = 15_000) {
	const res = await fetch(AAVE_GRAPHQL_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query, variables }),
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
	return res.json();
}

async function fetchLiquidationsForChain(
	address: string,
	chainId: number,
	market: string,
): Promise<AaveLiquidation[]> {
	const chain = CHAIN_KEYS[chainId] ?? String(chainId);
	const events: AaveLiquidation[] = [];
	let cursor: string | null = null;

	while (true) {
		const variables: Record<string, unknown> = {
			request: {
				user: address.toLowerCase(),
				chainId,
				market,
				filter: 'LIQUIDATION_CALL',
				pageSize: 'FIFTY',
				orderBy: { date: 'DESC' },
			},
		};
		if (cursor) (variables.request as Record<string, unknown>).cursor = cursor;

		let json: any;
		try {
			json = await postGraphQL(LIQUIDATION_QUERY, variables);
		} catch {
			break;
		}

		const items: any[] = json?.data?.userTransactionHistory?.items ?? [];
		const next: string | null = json?.data?.userTransactionHistory?.pageInfo?.next ?? null;

		for (const item of items) {
			if (item.__typename !== 'UserLiquidationCallTransaction') continue;

			const colValue = String(item.collateral?.amount?.amount?.value ?? '0');
			const colDecimals = Number(item.collateral?.amount?.amount?.decimals ?? 18);
			const collateralAmount = rawToDecimal(colValue, colDecimals);
			const collateralUsd = Number(item.collateral?.amount?.usd ?? 0);

			const debtValue = String(item.debtRepaid?.amount?.amount?.value ?? '0');
			const debtDecimals = Number(item.debtRepaid?.amount?.amount?.decimals ?? 6);
			const debtAmount = rawToDecimal(debtValue, debtDecimals);
			const debtUsd = Number(item.debtRepaid?.amount?.usd ?? 0);

			events.push({
				txHash: item.txHash,
				timestamp: toTimestampIso(item.timestamp),
				blockExplorerUrl: item.blockExplorerUrl ?? '',
				chain,
				collateralSymbol: item.collateral?.reserve?.underlyingToken?.symbol ?? 'UNKNOWN',
				collateralAmount,
				collateralUsd,
				debtSymbol: item.debtRepaid?.reserve?.underlyingToken?.symbol ?? 'UNKNOWN',
				debtAmount,
				debtUsd,
				penaltyUsd: collateralUsd - debtUsd,
			});
		}

		if (!next || items.length === 0) break;
		cursor = next;
	}

	return events;
}

export async function fetchAllLiquidationsForWallet(address: string): Promise<AaveLiquidation[]> {
	const settled = await Promise.allSettled(
		CHAIN_IDS.map((chainId) => {
			const market = MARKET_ADDRESSES[chainId];
			if (!market) return Promise.resolve([]);
			return fetchLiquidationsForChain(address, chainId, market);
		}),
	);

	const events: AaveLiquidation[] = [];
	for (const result of settled) {
		if (result.status === 'fulfilled') events.push(...result.value);
	}

	return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export async function syncLiquidationsToImportTransactions(
	tenantId: string,
	address: string,
): Promise<number> {
	const events = await fetchAllLiquidationsForWallet(address);
	if (!events.length) return 0;

	// One import per chain: each chain's rows carry their own source and batch id.
	const byChain = new Map<string, ImportTxRow[]>();
	for (const event of events) {
		const rowHash = `aave-liq:${event.txHash}:${event.chain}`;

		const description =
			`Aave liquidation on ${event.chain} — ` +
			`${event.collateralAmount.toFixed(6)} ${event.collateralSymbol} seized to repay ${event.debtSymbol} loan`;
		const notes =
			`Debt cleared: $${event.debtUsd.toFixed(2)} · ` +
			`Liquidation penalty: $${event.penaltyUsd.toFixed(2)}`;

		const rows = byChain.get(event.chain) ?? byChain.set(event.chain, []).get(event.chain)!;
		rows.push({
			timestampUtc: event.timestamp,
			direction: 'out',
			assetSymbol: event.collateralSymbol,
			amount: event.collateralAmount,
			nativeUsd: event.collateralUsd,
			kind: 'crypto_transfer',
			rowHash,
			txHash: event.txHash,
			description,
			notes,
			category: 'liquidation',
		});
	}

	let imported = 0;
	for (const [chain, rows] of byChain) {
		const result = await insertImportBatch({
			tenantId,
			accountId: null,
			source: `aave_${chain}`,
			batchId: `aave-liq-${tenantId.slice(0, 8)}-${chain}`,
			rows,
		});
		imported += result.insertedNormalized;
	}

	if (imported > 0) {
		try {
			await ensureUserLangColumn();
			const alertRes = await db.execute({
				sql: `SELECT au.alert_email, au.lang
				      FROM tenant_memberships tm
				      JOIN auth_users au ON au.id = tm.user_id
				      WHERE tm.tenant_id = ?
				        AND au.liquidation_alert = 1
				        AND au.alert_email IS NOT NULL`,
				args: [tenantId],
			});
			const appBase = process.env.AUTH_URL ?? 'https://almstins.com';
			for (const row of alertRes.rows) {
				const toEmail = typeof (row as Record<string, unknown>).alert_email === 'string'
					? String((row as Record<string, unknown>).alert_email)
					: null;
				if (!toEmail) continue;
				const rawLang = (row as Record<string, unknown>).lang;
				const lang = typeof rawLang === 'string' && isLang(rawLang) ? rawLang : 'en';
				const { subject, text } = getLiquidationAlert(lang).render({ address, imported, appBase });
				await sendMail({ to: toEmail, subject, text }).catch((err) => {
					console.error('[syncLiquidations] email send failed', err);
				});
			}
		} catch (err) {
			console.error('[syncLiquidations] alert query failed', err);
		}
	}

	return imported;
}
