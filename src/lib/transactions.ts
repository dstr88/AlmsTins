import { db } from './db';

export type NewTransaction = {
	walletId: string;
	hash: string;
	chain: string;
	blockNumber?: number;
	timestamp: Date;
	from?: string;
	to?: string;
	value?: string;
	tokenSymbol?: string;
	tokenDecimals?: number;
	contractAddress?: string;
	txType?: string;
	status?: string;
	feePaid?: string;
	metadata?: Record<string, any>;
};

export type TransactionFilter = {
	chain?: string;
	limit?: number;
	offset?: number;
	from?: Date;
	to?: Date;
};

export type NewTransactionAnnotation = {
	transactionId: string;
	category?: string;
	note?: string;
};

export type TransactionRow = Record<string, any>;
export type RichTransaction = TransactionRow & {
	note?: string | null;
	category?: string | null;
	direction?: string | null;
};

type DbRow = Record<string, unknown>;

const toStringOrEmpty = (value: unknown) => (typeof value === 'string' ? value : '');

const toWalletRow = (row: unknown): { id: string; address: string; chain?: string } | null => {
	if (!row || typeof row !== 'object') return null;
	const r = row as DbRow;
	return {
		id: toStringOrEmpty(r.id),
		address: toStringOrEmpty(r.address),
		chain: typeof r.chain === 'string' ? r.chain : undefined,
	};
};

export type SmartFlags = {
	internalTransfer: boolean;
	likelyLost: boolean;
	aaveMovement: boolean;
	newDeposit: boolean;
	riskTags: string[];
};

export async function bulkUpsertTransactions(tenantId: string, txs: NewTransaction[]) {
	if (!txs.length) return [];
	const statements = txs.map((tx) => ({
		sql: `INSERT INTO transactions
      (tenant_id, wallet_id, hash, chain, block_number, timestamp, from_address, to_address, value, token_symbol, token_decimals, contract_address, tx_type, status, fee_paid, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, hash, chain) DO UPDATE SET
        wallet_id = excluded.wallet_id,
        block_number = excluded.block_number,
        timestamp = excluded.timestamp,
        from_address = excluded.from_address,
        to_address = excluded.to_address,
        value = excluded.value,
        token_symbol = excluded.token_symbol,
        token_decimals = excluded.token_decimals,
        contract_address = excluded.contract_address,
        tx_type = excluded.tx_type,
        status = excluded.status,
        fee_paid = excluded.fee_paid,
        metadata_json = excluded.metadata_json
      RETURNING *`,
		args: [
			tenantId,
			tx.walletId,
			tx.hash,
			tx.chain,
			tx.blockNumber ?? null,
			tx.timestamp.toISOString(),
			tx.from ?? null,
			tx.to ?? null,
			tx.value ?? null,
			tx.tokenSymbol ?? null,
			tx.tokenDecimals ?? null,
			tx.contractAddress ?? null,
			tx.txType ?? null,
			tx.status ?? null,
			tx.feePaid ?? null,
			tx.metadata ? JSON.stringify(tx.metadata) : null,
		],
	}));

	const results = await Promise.all(statements.map((stmt) => db.execute(stmt)));
	return results.map((result) => result.rows[0]);
}

export async function getTransactionsForWallet(tenantId: string, walletId: string, options: TransactionFilter = {}) {
	const walletResult = await db.execute({
		sql: 'SELECT id, address, chain FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
		args: [walletId, tenantId],
	});
	if (!walletResult.rows.length) {
		throw new Error('Wallet not found');
	}
	const wallet = toWalletRow(walletResult.rows[0]);
	if (!wallet?.address) {
		throw new Error('Wallet not found');
	}
	const rawAddress = wallet.address;
	const address = typeof rawAddress === 'string' ? rawAddress.toLowerCase() : String(rawAddress).toLowerCase();
	const clauses = ['(LOWER(t.from_address) = ? OR LOWER(t.to_address) = ?)'];
	const args: any[] = [address, address];

	if (options.chain) {
		clauses.push('t.chain = ?');
		args.push(options.chain);
	}
	if (options.from) {
		clauses.push('t.timestamp >= ?');
		args.push(options.from.toISOString());
	}
	if (options.to) {
		clauses.push('t.timestamp <= ?');
		args.push(options.to.toISOString());
	}

	// Clamp before interpolation — LIMIT/OFFSET can't be bound params in this
	// query builder, so keep them provably integer to prevent SQL injection or
	// a NaN-triggered 500 regardless of what the caller passes.
	const limit = Math.min(Math.max(Math.trunc(Number(options.limit)) || 50, 1), 500);
	const offset = Math.max(Math.trunc(Number(options.offset)) || 0, 0);

	const query = `SELECT t.*, a.direction, a.category, a.note
    FROM transactions t
    LEFT JOIN transaction_annotations a
      ON a.transaction_id = t.id AND a.tenant_id = t.tenant_id
    WHERE t.tenant_id = ? AND ${clauses.join(' AND ')}
    ORDER BY t.timestamp DESC
    LIMIT ${limit} OFFSET ${offset}`;

	const result = await db.execute({ sql: query, args: [tenantId, ...args] });
	return result.rows;
}

export async function getTransactionsForWalletDashboard(
	tenantId: string,
	walletId: string,
	opts: { limit?: number; offset?: number; fromDate?: string; toDate?: string } = {},
) {
	const walletResult = await db.execute({
		sql: 'SELECT id, address FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
		args: [walletId, tenantId],
	});
	if (!walletResult.rows.length) {
		throw new Error('Wallet not found');
	}
	const wallet = toWalletRow(walletResult.rows[0]);
	if (!wallet?.address) {
		throw new Error('Wallet not found');
	}
	const rawAddress = wallet.address;
	const normalizedAddress = typeof rawAddress === 'string' ? rawAddress.toLowerCase() : String(rawAddress).toLowerCase();
	const myWalletAddresses = [normalizedAddress];

	const clauses = ['(LOWER(t.from_address) = ? OR LOWER(t.to_address) = ?)'];
	const params: any[] = [normalizedAddress, normalizedAddress];

	if (opts.fromDate) {
		clauses.push('t.timestamp >= ?');
		params.push(new Date(opts.fromDate).toISOString());
	}
	if (opts.toDate) {
		clauses.push('t.timestamp <= ?');
		params.push(new Date(opts.toDate).toISOString());
	}

	const limit = Math.min(Math.max(Math.trunc(Number(opts.limit)) || 50, 1), 500);
	const offset = Math.max(Math.trunc(Number(opts.offset)) || 0, 0);

	const query = `SELECT t.*, a.category, a.note
		FROM transactions t
		LEFT JOIN transaction_annotations a ON a.transaction_id = t.id AND a.tenant_id = t.tenant_id
		WHERE t.tenant_id = ? AND ${clauses.join(' AND ')}
		ORDER BY t.timestamp DESC
		LIMIT ${limit} OFFSET ${offset}`;

	const result = await db.execute({ sql: query, args: [tenantId, ...params] });
	return result.rows.map((row: any) => {
		const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : null;
		const tx: TransactionRow = {
			id: row.id,
			walletId: row.wallet_id,
			hash: row.hash,
			chain: row.chain,
			blockNumber: row.block_number,
			timestamp: row.timestamp,
			from_address: row.from_address,
			to_address: row.to_address,
			value: row.value,
			token_symbol: row.token_symbol,
			token_decimals: row.token_decimals,
			tx_type: row.tx_type,
			status: row.status,
			fee_paid: row.fee_paid,
			metadata,
		};
		const flags = computeSmartFlags(tx, myWalletAddresses);
		return { ...row, metadata, ...flags };
	});
}

export async function upsertTransactionAnnotation(tenantId: string, annotation: NewTransactionAnnotation) {
	await db.execute({
		sql: `INSERT INTO transaction_annotations (id, tenant_id, transaction_id, category, note, created_at, updated_at)
        VALUES (lower(replace(gen_random_uuid()::text,'-','')), ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'), to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
        ON CONFLICT(tenant_id, transaction_id) DO UPDATE SET category = excluded.category, note = excluded.note, updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')`,
		args: [tenantId, annotation.transactionId, annotation.category ?? null, annotation.note ?? null],
	});
}

export function isInternalTransfer(tx: TransactionRow, myWalletAddresses: string[]): boolean {
	const from = tx.from_address?.toLowerCase() || tx.from?.toLowerCase();
	const to = tx.to_address?.toLowerCase() || tx.to?.toLowerCase();
	if (!from || !to) return false;
	return myWalletAddresses.includes(from) && myWalletAddresses.includes(to);
}

const BURN_ADDRESSES = new Set([
	'0x0000000000000000000000000000000000000000',
	'0x000000000000000000000000000000000000dead',
]);

export function isLikelyLost(tx: TransactionRow): boolean {
	const to = tx.to_address?.toLowerCase() || tx.to?.toLowerCase();
	return Boolean(to && BURN_ADDRESSES.has(to));
}

export function computeSmartFlags(tx: TransactionRow, myWalletAddresses: string[]): SmartFlags {
	const riskTags: string[] = [];
	const lowerFrom = tx.from_address?.toLowerCase() || tx.from?.toLowerCase() || '';
	const lowerTo = tx.to_address?.toLowerCase() || tx.to?.toLowerCase() || '';
	const walletSet = new Set(myWalletAddresses.map((addr) => addr.toLowerCase()));

	const internalTransfer = isInternalTransfer(tx, myWalletAddresses);
	const likelyLost = isLikelyLost(tx);
	if (internalTransfer) riskTags.push('internal');
	if (likelyLost) riskTags.push('lost');

	const tokenName = tx.metadata?.tokenName?.toString().toLowerCase?.() ?? '';
	const source = tx.metadata?.source?.toString().toLowerCase?.() ?? '';
	const aaveAddresses = [
		'0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', // Ethereum V3 Pool
		'0xa434d495249abe33e031fe71a969b81f3c07950d', // Ethereum V3 PoolAddressesProvider
		'0x794a61358d6845594f94dc1db02a252b5b4814ad', // Avalanche V3 Pool (also Polygon V3 Pool)
	];
	const aaveMovement = Boolean(
		(lowerTo && aaveAddresses.includes(lowerTo)) || tokenName.includes('aave') || source.includes('aave'),
	);
	if (aaveMovement) riskTags.push('aave');

	const newDeposit = Boolean(
		lowerTo && walletSet.has(lowerTo) && (!lowerFrom || !walletSet.has(lowerFrom)) && tx.value !== '0',
	);
	if (newDeposit) riskTags.push('new-deposit');

	return {
		internalTransfer,
		likelyLost,
		aaveMovement,
		newDeposit,
		riskTags,
	};
}
