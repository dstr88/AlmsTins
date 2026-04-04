// src/lib/exchangeHoldings.ts
//
// Shared exchange holdings computation — extracted from ExchangeAccounts.astro
// so networth.ts can use it too (for Portfolio tile market-value totals).

export type ImportRow = {
	timestamp_utc: string;
	asset_symbol: string | null;
	direction: string | null;
	currency: string | null;
	amount: number | null;
	to_currency: string | null;
	to_amount: number | null;
	native_usd: number | null;
	kind: string | null;
	description: string | null;
};

export type Holding = {
	symbol: string;
	balance: number;   // liquid (not in staking)
	staked: number;    // currently locked in staking
	stakingYtd: number;
	stakingYtdUsd: number | null;
	lastPurchaseAt: string | null;
	costBasis: number | null;
};

const CURRENT_YEAR = String(new Date().getFullYear());

const parseNum = (v: unknown): number | null => {
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	if (typeof v === 'string') {
		const n = Number(v.replace(/,/g, ''));
		return Number.isFinite(n) ? n : null;
	}
	return null;
};

const normalizeSymbol = (s: string): string => {
	const u = s.trim().toUpperCase();
	if (u === 'MATIC' || u === 'WMATIC') return 'POL';
	return u;
};

const pickSymbol = (row: ImportRow): string =>
	row.asset_symbol || row.to_currency || row.currency || '';

const pickQty = (row: ImportRow): number | null => {
	const sym = pickSymbol(row);
	if (!sym) return null;
	if (row.to_currency && sym === row.to_currency) return row.to_amount;
	if (row.currency && sym === row.currency) return row.amount;
	return row.to_amount ?? row.amount;
};

export function computeHoldings(rows: ImportRow[]): Holding[] {
	const balanceMap       = new Map<string, number>();
	const stakedMap        = new Map<string, number>();
	const stakingYtdMap    = new Map<string, number>();
	const stakingYtdUsdMap = new Map<string, number>();
	const lastPurchaseMap  = new Map<string, string>();
	const lastSeenMap      = new Map<string, string>();
	const lotsMap          = new Map<string, Array<{ qty: number; cost: number }>>();
	const unknownCost      = new Set<string>();

	for (const row of rows) {
		const raw = pickSymbol(row);
		if (!raw) continue;
		const sym = normalizeSymbol(raw);
		if (row.timestamp_utc) lastSeenMap.set(sym, row.timestamp_utc);
		const qtyRaw = parseNum(pickQty(row));
		if (qtyRaw === null || qtyRaw === 0) continue;
		const qty = Math.abs(qtyRaw);
		const dir = row.direction ?? (qtyRaw < 0 ? 'out' : 'in');
		const kindLower = (row.kind ?? '').toLowerCase();

		const isStakingIn   = kindLower.includes('retail staking transfer')   && dir === 'in';
		const isUnstakingIn = kindLower.includes('retail unstaking transfer') && dir === 'in';

		if (isStakingIn) {
			stakedMap.set(sym, (stakedMap.get(sym) ?? 0) + qty);
		} else if (isUnstakingIn) {
			balanceMap.set(sym, (balanceMap.get(sym) ?? 0) + qty);
			stakedMap.set(sym, Math.max(0, (stakedMap.get(sym) ?? 0) - qty));
			lastPurchaseMap.set(sym, row.timestamp_utc);
		} else if (dir === 'in') {
			balanceMap.set(sym, (balanceMap.get(sym) ?? 0) + qty);
			// Staking income is ordinary income, not a purchase — don't let it
			// reset the holding-period clock used for long-term capital gains tracking.
			if (kindLower !== 'staking income') {
				lastPurchaseMap.set(sym, row.timestamp_utc);
			}
			const cost = parseNum(row.native_usd);
			if (cost === null) {
				unknownCost.add(sym);
			} else {
				const lots = lotsMap.get(sym) ?? [];
				lots.push({ qty, cost: Math.abs(cost) });
				lotsMap.set(sym, lots);
			}

			if (kindLower === 'staking income' && row.timestamp_utc.startsWith(CURRENT_YEAR)) {
				stakingYtdMap.set(sym, (stakingYtdMap.get(sym) ?? 0) + qty);
				const usd = parseNum(row.native_usd);
				if (usd !== null) stakingYtdUsdMap.set(sym, (stakingYtdUsdMap.get(sym) ?? 0) + Math.abs(usd));
			}
		} else if (dir === 'out' || dir === 'lost') {
			balanceMap.set(sym, (balanceMap.get(sym) ?? 0) - qty);
			const lots = lotsMap.get(sym);
			if (lots?.length) {
				let rem = qty;
				while (rem > 0 && lots.length) {
					const lot = lots[0];
					if (lot.qty <= rem) { rem -= lot.qty; lots.shift(); }
					else { const r = rem / lot.qty; lot.qty -= rem; lot.cost -= lot.cost * r; rem = 0; }
				}
			}
		}
	}

	const seenSyms = new Set<string>([
		...balanceMap.keys(),
		...stakedMap.keys(),
		...stakingYtdMap.keys(),
	]);
	const out: Holding[] = [];
	for (const sym of seenSyms) {
		let bal    = balanceMap.get(sym) ?? 0;
		let staked = stakedMap.get(sym)  ?? 0;

		if (bal < 0 && staked > 0) {
			const draw = Math.min(staked, Math.abs(bal));
			staked -= draw;
			bal    += draw;
		}
		bal    = Math.max(0, bal);
		staked = Math.max(0, staked);

		const stakingYtd    = stakingYtdMap.get(sym)    ?? 0;
		const stakingYtdUsd = stakingYtdUsdMap.get(sym) ?? null;
		if (bal <= 0 && staked <= 0 && stakingYtd <= 0) continue;

		const lots = lotsMap.get(sym) ?? [];
		out.push({
			symbol: sym,
			balance: Math.max(0, bal),
			staked,
			stakingYtd,
			stakingYtdUsd: stakingYtdUsdMap.has(sym) ? (stakingYtdUsd ?? 0) : null,
			lastPurchaseAt: lastPurchaseMap.get(sym) ?? lastSeenMap.get(sym) ?? null,
			costBasis: unknownCost.has(sym) || !lots.length ? null : lots.reduce((s, l) => s + l.cost, 0),
		});
	}
	return out.sort((a, b) => (b.balance + b.staked) - (a.balance + a.staked));
}
