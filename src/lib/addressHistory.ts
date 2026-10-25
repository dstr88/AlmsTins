/**
 * addressHistory.ts: totals of the user's own transactions with one address, for
 * GET /api/address-history. Pure: the rows come from loadHistoryRows (src/lib/historyRows.ts)
 * with a counterparty filter.
 *
 * Amounts are the plain decimal strings historyRows writes, added exactly as scaled integers,
 * never as floating point. A total that cannot be known is left out ('') rather than guessed:
 * a USD total needs a value on every row it covers, and an amount total needs every amount.
 * A failed transaction moved nothing, so it counts as zero, in amount and in USD.
 *
 * Records only: no cost basis, gain or loss.
 */

import type { HistoryRow } from './historyRows';

export type AddressHistoryRow = Pick<HistoryRow, 'chain' | 'asset' | 'direction' | 'amount' | 'usdValue' | 'failed' | 'date' | 'sortKey'>;

export interface AddressHistoryTotal {
	asset: string;
	chain: string;
	/** Sent to the address, as a plain decimal string; '' when an amount is unknown. */
	sent: string;
	received: string;
	/** Rows of this asset and chain, failed ones included. */
	count: number;
	/** USD total of the sent rows; '' when there is none or a row has no USD value. */
	sentUsd: string;
	receivedUsd: string;
}

export interface AddressHistorySummary {
	totals: AddressHistoryTotal[];
	/** Earliest and latest row date ("YYYY-MM-DD HH:MM:SS" UTC), '' when there are no rows. */
	firstDate: string;
	lastDate: string;
}

// ── Exact decimal sums ───────────────────────────────────────────────────────

/** A non-negative decimal as digits and a scale: "12.50" → { units: 1250n, scale: 2 }. */
interface Scaled {
	units: bigint;
	scale: number;
}

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

function parseDecimal(s: string): Scaled | null {
	const m = DECIMAL.exec(s.trim());
	if (!m) return null;
	const frac = m[2] ?? '';
	return { units: BigInt(m[1] + frac), scale: frac.length };
}

function addScaled(a: Scaled, b: Scaled): Scaled {
	const scale = Math.max(a.scale, b.scale);
	const up = (x: Scaled) => x.units * 10n ** BigInt(scale - x.scale);
	return { units: up(a) + up(b), scale };
}

function formatScaled({ units, scale }: Scaled): string {
	if (scale === 0) return units.toString();
	const digits = units.toString().padStart(scale + 1, '0');
	const whole = digits.slice(0, -scale);
	const fraction = digits.slice(-scale).replace(/0+$/, '');
	return fraction ? `${whole}.${fraction}` : whole;
}

const ZERO: Scaled = { units: 0n, scale: 0 };

/** A running sum that turns unknown (null) once one value cannot be read. */
class Sum {
	private total: Scaled | null = ZERO;
	private rows = 0;

	add(value: string): void {
		this.rows++;
		if (this.total === null) return;
		const parsed = parseDecimal(value);
		this.total = parsed ? addScaled(this.total, parsed) : null;
	}

	/** The sum, or '' when a value was unknown; `emptyAs` when nothing was added. */
	result(emptyAs: string): string {
		if (this.rows === 0) return emptyAs;
		return this.total === null ? '' : formatScaled(this.total);
	}
}

// ── Summary ──────────────────────────────────────────────────────────────────

interface Group {
	asset: string;
	chain: string;
	count: number;
	sent: Sum;
	received: Sum;
	sentUsd: Sum;
	receivedUsd: Sum;
}

export function summarizeAddressHistory(rows: readonly AddressHistoryRow[]): AddressHistorySummary {
	const groups = new Map<string, Group>();
	let first: AddressHistoryRow | null = null;
	let last: AddressHistoryRow | null = null;

	for (const row of rows) {
		const key = `${row.chain}\u0000${row.asset}`;
		let g = groups.get(key);
		if (!g) {
			g = { asset: row.asset, chain: row.chain, count: 0, sent: new Sum(), received: new Sum(), sentUsd: new Sum(), receivedUsd: new Sum() };
			groups.set(key, g);
		}
		g.count++;

		// 'lost' is an asset that left the account; '' tells no way, so it is in neither total.
		const side = row.direction === 'in' ? 'received' : row.direction === 'out' || row.direction === 'lost' ? 'sent' : null;
		if (side) {
			g[side].add(row.failed ? '0' : row.amount);
			g[side === 'sent' ? 'sentUsd' : 'receivedUsd'].add(row.failed ? '0' : row.usdValue);
		}

		if (row.sortKey) {
			if (!first || row.sortKey < first.sortKey) first = row;
			if (!last || row.sortKey > last.sortKey) last = row;
		}
	}

	const totals = [...groups.values()]
		.sort((a, b) => (a.chain !== b.chain ? (a.chain < b.chain ? -1 : 1) : a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0))
		.map((g) => ({
			asset: g.asset,
			chain: g.chain,
			sent: g.sent.result('0'),
			received: g.received.result('0'),
			count: g.count,
			sentUsd: g.sentUsd.result(''),
			receivedUsd: g.receivedUsd.result(''),
		}));

	return { totals, firstDate: first?.date ?? '', lastDate: last?.date ?? '' };
}
