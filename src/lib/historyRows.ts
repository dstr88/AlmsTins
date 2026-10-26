/**
 * historyRows.ts: the tenant's transaction history as one list of rows, shared by the plain CSV
 * (GET /api/transactions/export, every plan) and the history by wallet ZIP
 * (GET /api/records/history-by-wallet, paid plans).
 *
 * Three halves, each scoped by the session's tenant_id:
 *   import_transactions  exchange CSVs and chain-synced imports (bitcoin, solana, avalanche_cchain)
 *   transactions         on-chain EVM rows and custom-wallet entries, with their annotation
 *   sui_transactions     Sui wallets
 *
 * Counterparties: EVM rows store from_address / to_address; Bitcoin, Solana and Sui rows store
 * counterparty_address (src/lib/counterpartyColumn.ts), filled by syncs since it was added, so
 * older rows may have none.
 *
 * Fixes over the old export: a wallet filter applies to every half (it used to filter only
 * the on-chain half, so a one-wallet file held every exchange row), rows flagged as
 * duplicates are skipped (the same predicate as /api/transactions/list), Sui is included,
 * on-chain amounts are converted from raw units, a failed transaction moves nothing, an
 * imported row marked lost keeps that direction, Sui gas is counted once, and
 * the order is deterministic (time, then half, then id).
 *
 * Records only: no cost basis, gain/loss, lot or holding period, and nothing here reads the
 * annual breakdown. Every text value is untrusted (on-chain token symbols included); the CSV
 * writer in historyExport.ts escapes each cell.
 */

import { db } from './db';
import { getImportTransactionColumns, selectImportColumn, selectImportNotes } from './importTransactionsSchema';
import { isChainSource, normalizeChain, parseWalletKey } from './walletKey';
import type { WalletRef } from './walletIdentity';
import { refOfImportRow, refOfOnchainRow, refOfSuiRow } from './tax/walletOfRow';
import { addressNetwork } from './addressNetwork';
import { ensureCounterpartyColumns } from './counterpartyColumn';
import { canonicalAddress } from './wallets-service';
import { evmNativeSymbol } from './chains';
import { plainNumber, rawToDecimal } from './decimalText';

export type HistoryOrigin = 'import' | 'onchain' | 'sui';
export type HistoryDirection = 'in' | 'out' | 'lost' | '';

export interface HistoryRow {
	origin: HistoryOrigin;
	/** Row id, used for ordering only; never written to a file. */
	id: string;
	ref: WalletRef;
	/** Stored source: 'crypto_com', 'bitcoin', or the chain for on-chain and Sui rows. */
	source: string;
	/** Normalized chain, '' for an exchange row. */
	chain: string;
	/** "YYYY-MM-DD HH:MM:SS" in UTC, or the stored text when it cannot be read as a date. */
	date: string;
	/** ISO string used to sort. */
	sortKey: string;
	/**
	 * 'lost' is how the exchange importers store a row the file marks as lost, burned or sent
	 * on the wrong chain: the asset left the account. '' only when nothing tells the way.
	 */
	direction: HistoryDirection;
	asset: string;
	/** Plain decimal strings, never negative, never in exponent form. '' when unknown. */
	amount: string;
	usdValue: string;
	fee: string;
	feeAsset: string;
	txHash: string;
	counterparty: string;
	category: string;
	notes: string;
	failed: boolean;
}

export interface HistoryQuery {
	/** Calendar year (UTC). Omitted = all years. */
	year?: number;
	/** One wallet, already checked to belong to the tenant. Omitted = every wallet. */
	wallet?: { id: string; address: string };
	/**
	 * Only rows sent to or received from this full address (GET /api/address-history). An EVM
	 * address matches the on-chain half's from/to without case. Any other address matches the
	 * import and Sui halves' counterparty_address exactly, in canonicalAddress form (base58 as
	 * written, bech32 and hex lowercased); rows synced before that column existed have none.
	 * An empty value, or one that is not an address, selects nothing at all.
	 */
	counterparty?: string;
}

// ── Pure formatting helpers ──────────────────────────────────────────────────

const str = (v: unknown): string => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v));

function finite(v: unknown): number | null {
	if (v == null || v === '') return null;
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : null;
}

export { plainNumber, rawToDecimal };

const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** Stored timestamps are ISO with Z, or "YYYY-MM-DD HH:MM:SS" meaning UTC. */
export function toUtcDate(v: unknown): { date: string; sortKey: string } {
	const raw = str(v).trim();
	if (!raw) return { date: '', sortKey: '' };
	const text = NAIVE_DATETIME.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
	const ms = Date.parse(text);
	if (!Number.isFinite(ms)) return { date: raw, sortKey: raw };
	const iso = new Date(ms).toISOString();
	return { date: `${iso.slice(0, 10)} ${iso.slice(11, 19)}`, sortKey: iso };
}

/** The native coin of an EVM chain (src/lib/chains.ts); '' off EVM, where rows name their asset. */
export function nativeSymbol(chain: unknown): string {
	return evmNativeSymbol(chain);
}

const compareSymbol = (s: unknown) => {
	const u = str(s).trim().toUpperCase();
	return u === 'MATIC' || u === 'WMATIC' ? 'POL' : u;
};

const lower = (v: unknown) => str(v).trim().toLowerCase();

const SUI_NATIVE = /^0x0*2::sui::SUI$/i;

/** Rows ordered by time, then half (import, onchain, sui), then id. */
export function compareRows(a: HistoryRow, b: HistoryRow): number {
	if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
	if (a.origin !== b.origin) return a.origin < b.origin ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ── Row mappers (pure) ───────────────────────────────────────────────────────

type DbRow = Record<string, unknown>;

/**
 * An imported row's direction: the stored one when it is in, out or lost (the importers write
 * those three), otherwise the sign of the amount, as exchangeHoldings.ts reads it.
 */
export function importDirection(stored: unknown, amount: number | null): HistoryDirection {
	const dir = lower(stored);
	if (dir === 'in' || dir === 'out' || dir === 'lost') return dir;
	if (amount === null || amount === 0) return '';
	return amount < 0 ? 'out' : 'in';
}

export function mapImportRow(r: DbRow): HistoryRow {
	const source = str(r.source).trim();
	const asset = (str(r.asset_symbol) || str(r.to_currency) || str(r.currency)).trim();
	const sym = compareSymbol(asset);
	let amount: number | null;
	if (sym && compareSymbol(r.to_currency) === sym && finite(r.to_amount) !== null) amount = finite(r.to_amount);
	else if (sym && compareSymbol(r.currency) === sym && finite(r.amount) !== null) amount = finite(r.amount);
	else amount = finite(r.to_amount) ?? finite(r.amount);

	let usd = finite(r.native_usd);
	if (usd === null && compareSymbol(r.native_currency) === 'USD') usd = finite(r.native_amount);

	let fee = '';
	let feeAsset = '';
	const feeNative = finite(r.fee_native);
	const feeUsd = finite(r.fee_usd);
	if (feeNative !== null && feeNative !== 0) {
		fee = plainNumber(feeNative);
		feeAsset = str(r.fee_currency).trim();
	} else if (feeUsd !== null && feeUsd !== 0) {
		fee = plainNumber(feeUsd);
		feeAsset = 'USD';
	}

	// Chain-synced imports key on the wallet (account ids are shared across addresses);
	// exchange rows key on the account, or the per-exchange unassigned bucket (tax/walletOfRow.ts).
	const ref = refOfImportRow(r);
	const { date, sortKey } = toUtcDate(r.timestamp_utc);
	return {
		origin: 'import',
		id: str(r.id),
		ref,
		source,
		chain: isChainSource(source) ? normalizeChain(source) : '',
		date,
		sortKey,
		direction: importDirection(r.direction, amount),
		asset,
		amount: plainNumber(amount),
		usdValue: plainNumber(usd),
		fee,
		feeAsset,
		txHash: str(r.tx_hash).trim(),
		counterparty: str(r.counterparty_address).trim(),
		category: (str(r.category) || str(r.kind)).trim(),
		notes: (str(r.notes) || str(r.description)).trim(),
		failed: false,
	};
}

function parseMeta(v: unknown): Record<string, unknown> | null {
	if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
	if (typeof v !== 'string' || !v.trim().startsWith('{')) return null;
	try {
		const parsed = JSON.parse(v);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function mapOnchainRow(r: DbRow): HistoryRow {
	const chain = normalizeChain(r.chain);
	const walletAddress = lower(r.wallet_address);
	const from = str(r.from_address).trim();
	const to = str(r.to_address).trim();
	const sent = !!walletAddress && lower(from) === walletAddress;
	const received = !!walletAddress && lower(to) === walletAddress;
	const txType = lower(r.tx_type);
	const meta = parseMeta(r.metadata_json);
	const isManual = meta?.isCustomEntry === true && meta.path === 'manual';
	const failed = lower(r.status) === 'failed';

	let direction: HistoryRow['direction'] = '';
	if (isManual) direction = meta?.direction === 'out' ? 'out' : 'in';
	else if (txType === 'incoming' || txType === 'token_in') direction = 'in';
	else if (txType === 'outgoing' || txType === 'token_out') direction = 'out';
	else if (sent) direction = 'out';
	else if (received) direction = 'in';

	const symbolRaw = str(r.token_symbol).trim();
	const asset = symbolRaw.toLowerCase() === 'native' ? nativeSymbol(chain) || symbolRaw : symbolRaw;

	let amount: string;
	let usd: number | null;
	if (isManual) {
		amount = plainNumber(meta?.amount);
		usd = finite(meta?.usdValue);
	} else {
		amount = rawToDecimal(r.value, r.token_decimals ?? 18);
		usd = finite(r.usd_value) ?? finite(meta?.usdValue);
	}
	if (failed) {
		amount = '0';
		usd = null;
	}

	// The network fee is the sender's: show it only on a transaction this wallet sent.
	const feeRaw = str(r.fee_paid).trim();
	const fee = sent && feeRaw ? rawToDecimal(feeRaw, 18) : '';
	const feeAsset = fee ? nativeSymbol(chain) : '';

	const { date, sortKey } = toUtcDate(r.timestamp);
	return {
		origin: 'onchain',
		id: str(r.id),
		ref: refOfOnchainRow(r),
		source: chain,
		chain,
		date,
		sortKey,
		direction,
		asset,
		amount,
		usdValue: usd !== null && usd !== 0 ? plainNumber(usd) : '',
		fee: fee === '0' ? '' : fee,
		feeAsset: fee === '0' ? '' : feeAsset,
		txHash: isManual ? '' : str(r.hash).trim(),
		counterparty: sent ? to : received ? from : '',
		category: (str(r.annotation_category) || str(meta?.kind) || str(r.tx_type)).trim(),
		notes: (str(r.annotation_note) || str(meta?.notes)).trim(),
		failed,
	};
}

/** A whole number of the smallest unit, sign dropped; null when it is not one. */
function rawUnits(v: unknown): bigint | null {
	const s = str(v).trim().replace(/^[-+]/, '');
	return /^\d+$/.test(s) ? BigInt(s) : null;
}

export function mapSuiRow(r: DbRow): HistoryRow | null {
	const rawAmount = str(r.amount).trim();
	const negative = rawAmount.startsWith('-');
	const decimals = finite(r.decimals) ?? 9;
	let amount = rawToDecimal(rawAmount, decimals);
	let isZero = !amount || /^0(\.0*)?$/.test(amount);
	let direction: HistoryDirection = negative || isZero ? 'out' : 'in';
	const coinType = str(r.coin_type).trim();
	const failed = lower(r.status) === 'failure';

	// The gas fee is stored on every row of a transaction; it belongs to the native SUI row this
	// wallet paid from (an outgoing or fee-only row). Sui's balance change for the gas payer
	// already includes the gas, so the fee is taken out of that row's amount: Amount and Fee
	// together are the balance change, and the gas is counted once (as on EVM, where the value
	// leaves the gas out).
	const feeRaw = str(r.fee_mist).trim();
	const paidFee = SUI_NATIVE.test(coinType) && (negative || isZero);
	let fee = paidFee && feeRaw ? rawToDecimal(feeRaw, 9) : '';
	if (fee === '0') fee = '';
	if (fee && negative && !failed) {
		const total = rawUnits(rawAmount);
		const gas = rawUnits(feeRaw);
		if (total !== null && gas !== null && decimals === 9) {
			const moved = total - gas;
			// More gas than the balance went down by: the wallet also received SUI in that transaction.
			direction = moved < 0n ? 'in' : 'out';
			amount = rawToDecimal((moved < 0n ? -moved : moved).toString(), 9);
			isZero = moved === 0n;
		} else {
			// Cannot split it exactly: the amount stays as the balance change, with the gas inside it.
			fee = '';
		}
	}
	// A failed transaction moves nothing; only the gas is paid (as for a failed on-chain row).
	if (failed) {
		amount = '0';
		isZero = true;
		direction = 'out';
	}
	if (isZero && !fee) return null;

	const { date, sortKey } = toUtcDate(r.timestamp);
	return {
		origin: 'sui',
		id: str(r.id),
		ref: refOfSuiRow(r),
		source: 'sui',
		chain: 'sui',
		date,
		sortKey,
		direction,
		asset: str(r.symbol).trim(),
		amount: isZero ? '0' : amount,
		usdValue: '',
		fee,
		feeAsset: fee ? 'SUI' : '',
		txHash: str(r.digest).trim(),
		counterparty: str(r.counterparty_address).trim(),
		category: str(r.category).trim(),
		notes: str(r.note).trim(),
		failed,
	};
}

// ── Loader (tenant-scoped) ───────────────────────────────────────────────────

/** Rows kept by the app's duplicate sweep: clean (0), or confirmed not a duplicate (-1). */
const NOT_DUPLICATE = (col: string) => `(${col} IS NULL OR ${col} = 0 OR ${col} = -1)`;

/**
 * The most rows one download builds. Both files are built in memory, and a build near 100,000
 * rows took about 400 MB in a measured run, enough to stop a small web instance for everyone.
 * Above this, the routes answer 413 and the page asks for one year at a time.
 */
export const MAX_HISTORY_ROWS = 50_000;

export class HistoryTooLargeError extends Error {
	constructor(
		readonly rows: number,
		readonly limit: number,
	) {
		super(`history has ${rows} rows, more than ${limit}`);
		this.name = 'HistoryTooLargeError';
	}
}

function yearBounds(year: number | undefined): [string, string] | null {
	if (year === undefined) return null;
	return [`${year}-01-01`, `${year + 1}-01-01`];
}

/** One half's statement: the same FROM and WHERE serve the count and the rows. */
interface HalfStatement {
	/** Table and alias, with no JOIN: what the count reads. */
	from: string;
	/** Columns and the JOINs the rows need (each JOIN matched on tenant_id). */
	select: string;
	joins: string;
	where: string;
	args: string[];
	map: (rows: DbRow[]) => HistoryRow[];
}

async function historyStatements(tenantId: string, query: HistoryQuery): Promise<HalfStatement[]> {
	const bounds = yearBounds(query.year);
	const isMirror = !!query.wallet && /^cex:/i.test(query.wallet.address.trim());
	const mirror = isMirror ? parseWalletKey(query.wallet!.address) : null;
	const accountFilter = mirror?.kind === 'cex' ? mirror.accountId : null;
	// A cex: wallet with no account id cannot select anything: fail closed.
	if (isMirror && !accountFilter) return [];
	const walletFilter = query.wallet && !isMirror ? query.wallet.id : null;
	const typed = query.counterparty === undefined ? null : query.counterparty.trim();
	const network = typed ? addressNetwork(typed) : null;
	if (typed !== null && network === null) return [];
	// An EVM counterparty is matched on the on-chain half (lowercased); any other on the import
	// and Sui halves' counterparty_address (canonical). Each filter selects nothing in the others.
	const counterparty = typed !== null && network === 'evm' ? typed.toLowerCase() : null;
	const storedCounterparty = typed !== null && network !== 'evm' ? canonicalAddress(typed) : null;
	const filtered = typed !== null;

	const columns = await getImportTransactionColumns();
	// Ensured once per process; until then (or if it cannot be) these rows have no counterparty.
	const kept = await ensureCounterpartyColumns();
	const has = (c: string) => columns.has(c) || (kept && c === 'counterparty_address');

	const out: HalfStatement[] = [];

	// ── Imported rows ──
	const importWallet = accountFilter !== null ? (has('account_id') ? 'AND account_id = ?' : null) : walletFilter !== null ? (has('wallet_id') ? 'AND wallet_id = ?' : null) : '';
	// A wallet filter on a column this database does not have selects nothing, not everything.
	// The same for a counterparty filter.
	const importCounterparty = !filtered ? '' : storedCounterparty !== null && has('counterparty_address') ? 'AND counterparty_address = ?' : null;
	if (importWallet !== null && importCounterparty !== null) {
		const args: string[] = [tenantId];
		let where = 'WHERE tenant_id = ?';
		if (has('is_duplicate')) where += ` AND ${NOT_DUPLICATE('is_duplicate')}`;
		if (bounds) {
			where += ' AND timestamp_utc >= ? AND timestamp_utc < ?';
			args.push(...bounds);
		}
		if (importWallet) {
			where += ` ${importWallet}`;
			args.push((accountFilter ?? walletFilter)!);
		}
		if (importCounterparty) {
			where += ` ${importCounterparty}`;
			args.push(storedCounterparty!);
		}
		out.push({
			from: 'import_transactions',
			select: `id, source, timestamp_utc, description, currency, amount, to_currency, to_amount,
			        native_currency, native_amount, native_usd, kind, tx_hash, direction, asset_symbol,
			        ${selectImportNotes(columns)}, ${selectImportColumn(columns, 'category')},
			        ${selectImportColumn(columns, 'fee_usd')}, ${selectImportColumn(columns, 'fee_native')},
			        ${selectImportColumn(columns, 'fee_currency')}, ${selectImportColumn(columns, 'account_id')},
			        ${selectImportColumn(columns, 'wallet_id')},
			        ${has('counterparty_address') ? 'counterparty_address' : 'NULL AS counterparty_address'}`,
			joins: '',
			where,
			args,
			map: (rows) => rows.map(mapImportRow),
		});
	}

	// ── On-chain rows (and custom-wallet entries) ──
	if (accountFilter === null && (!filtered || counterparty !== null)) {
		const args: string[] = [tenantId];
		let where = `WHERE t.tenant_id = ? AND ${NOT_DUPLICATE('t.is_duplicate')}`;
		if (bounds) {
			where += ' AND t.timestamp >= ? AND t.timestamp < ?';
			args.push(...bounds);
		}
		if (walletFilter !== null) {
			where += ' AND t.wallet_id = ?';
			args.push(walletFilter);
		}
		if (counterparty !== null) {
			where += ' AND (lower(t.from_address) = ? OR lower(t.to_address) = ?)';
			args.push(counterparty, counterparty);
		}
		out.push({
			from: 'transactions t',
			select: `t.id, t.wallet_id, t.chain, t.hash, t.timestamp, t.from_address, t.to_address, t.value,
			        t.token_symbol, t.token_decimals, t.tx_type, t.status, t.fee_paid, t.usd_value, t.metadata_json,
			        w.address AS wallet_address,
			        a.note AS annotation_note, a.category AS annotation_category`,
			joins: `LEFT JOIN wallets w ON w.id = t.wallet_id AND w.tenant_id = t.tenant_id
			      LEFT JOIN transaction_annotations a ON a.transaction_id = t.id AND a.tenant_id = t.tenant_id`,
			where,
			args,
			map: (rows) => rows.map(mapOnchainRow),
		});
	}

	// ── Sui rows ──
	if (accountFilter === null && (!filtered || (storedCounterparty !== null && kept))) {
		const suiArgs: string[] = [tenantId];
		let suiWhere = 'WHERE s.tenant_id = ?';
		if (bounds) {
			suiWhere += ' AND s.timestamp >= ? AND s.timestamp < ?';
			suiArgs.push(...bounds);
		}
		if (walletFilter !== null) {
			suiWhere += ' AND s.wallet_id = ?';
			suiArgs.push(walletFilter);
		}
		if (storedCounterparty !== null) {
			suiWhere += ' AND s.counterparty_address = ?';
			suiArgs.push(storedCounterparty);
		}
		out.push({
			from: 'sui_transactions s',
			select: `s.id, s.wallet_id, s.digest, s.coin_type, s.symbol, s.amount, s.decimals, s.timestamp,
			        s.fee_mist, s.status, s.note, s.category, ${kept ? 's.counterparty_address' : 'NULL AS counterparty_address'}`,
			joins: '',
			where: suiWhere,
			args: suiArgs,
			map: (rows) => rows.map(mapSuiRow).filter((r): r is HistoryRow => r !== null),
		});
	}

	return out;
}

/**
 * How many rows the statements would read (before empty Sui rows are dropped, so never
 * fewer). Cheap: a COUNT per half, nothing loaded.
 */
function countStatements(statements: readonly HalfStatement[]): Promise<number> {
	return Promise.all(
		statements.map((st) =>
			db
				.execute({ sql: `SELECT COUNT(*) AS n FROM ${st.from} ${st.where}`, args: st.args })
				.then((res) => Number((res.rows[0] as DbRow | undefined)?.n ?? 0) || 0),
		),
	).then((counts) => counts.reduce((a, b) => a + b, 0));
}

/**
 * Every transaction row of the tenant, mapped and sorted. With `query.wallet`, only that
 * wallet's rows, in every half: an exchange mirror wallet (address cex:{source}:{accountId})
 * selects that account's imported rows; any other wallet selects its on-chain, Sui and
 * chain-synced import rows by wallet_id. With `query.counterparty`, only rows sent to or received
 * from that address (see HistoryQuery).
 *
 * With `limit`, the halves are counted first, and more rows than the limit throws
 * HistoryTooLargeError before any row is loaded.
 */
export async function loadHistoryRows(tenantId: string, query: HistoryQuery = {}, limit?: number): Promise<HistoryRow[]> {
	const statements = await historyStatements(tenantId, query);
	if (limit !== undefined) {
		const rows = await countStatements(statements);
		if (rows > limit) throw new HistoryTooLargeError(rows, limit);
	}
	const halves = await Promise.all(
		statements.map((st) =>
			db
				.execute({ sql: `SELECT ${st.select} FROM ${st.from} ${st.joins} ${st.where}`, args: st.args })
				.then((res) => st.map(res.rows as DbRow[])),
		),
	);
	return halves.flat().sort(compareRows);
}
