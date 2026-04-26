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
	/**
	 * Symbol shown in the Days field when the coin was never purchased.
	 * null  = normal purchase — show days held
	 * '⚡'  = staking income only — no holding-period date
	 * '🪂'  = airdrop only
	 * '🎓'  = learning / Coinbase Earn reward only
	 * '∞'   = earned/received but type is unknown
	 */
	earnedSymbol: string | null;
	costBasis: number | null;
};

/** Hover tooltip text for each earnedSymbol. Exported so the UI can reuse it. */
export const EARNED_SYMBOL_TITLES: Record<string, string> = {
	'⚡': 'Staking reward — earned, not purchased. Each reward starts its own holding period from the date received.',
	'🪂': 'Airdrop — received free, not purchased. Holding period starts from the airdrop date.',
	'🎓': 'Learning / Coinbase Earn reward — earned, not purchased. Holding period starts from the reward date.',
	'∞':  'No purchase recorded — this coin was earned or received, origin type unknown.',
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

function addToSet(map: Map<string, Set<string>>, sym: string, kind: string) {
	const s = map.get(sym) ?? new Set<string>();
	s.add(kind);
	map.set(sym, s);
}

function resolveEarnedSymbol(kinds: Set<string>): string {
	if (kinds.has('airdrop'))   return '🪂';
	if (kinds.has('learning'))  return '🎓';
	if (kinds.has('staking'))   return '⚡';
	return '∞';
}

export function computeHoldings(rows: ImportRow[]): Holding[] {
	// ── Pre-pass 1: build max implied price per symbol ───────────────────────
	// Used to detect qty/price confusion (e.g. a BTC row recording $77,000 as
	// the coin count instead of the USD cost). Any inflow whose implied price is
	// < 1% of the per-symbol maximum is skipped as a corrupted lot.
	// Mirrors the threshold used by the Research diagnostics (Query 9).
	const maxImpliedPrice = new Map<string, number>();
	for (const row of rows) {
		const raw = pickSymbol(row);
		if (!raw || raw.trim().length < 2) continue;
		const sym = normalizeSymbol(raw);
		if (sym.length < 2) continue;
		const dir = row.direction ?? 'in';
		if (dir === 'out' || dir === 'lost') continue;
		const qty = parseNum(pickQty(row));
		const usd = parseNum(row.native_usd);
		if (qty && qty > 0 && usd && usd > 0) {
			const implied = Math.abs(usd) / qty;
			if (implied > (maxImpliedPrice.get(sym) ?? 0)) maxImpliedPrice.set(sym, implied);
		}
	}

	const balanceMap       = new Map<string, number>();
	const stakedMap        = new Map<string, number>();
	const stakingYtdMap    = new Map<string, number>();
	const stakingYtdUsdMap = new Map<string, number>();
	const lastPurchaseMap  = new Map<string, string>();
	const lastSeenMap      = new Map<string, string>();
	const lotsMap          = new Map<string, Array<{ qty: number; cost: number }>>();
	const unknownCost      = new Set<string>();
	// Tracks whether the symbol was ever acquired via a real buy/deposit/unstake.
	const purchasedEverMap = new Map<string, boolean>();
	// Tracks which earned-inflow types (staking/airdrop/learning) were seen when
	// no real purchase was recorded, so we can pick the right symbol.
	const earnedKindsMap   = new Map<string, Set<string>>();

	for (const row of rows) {
		const raw = pickSymbol(row);
		if (!raw) continue;
		const sym = normalizeSymbol(raw);
		// Guard: skip single-character symbols — CSV artifacts, not real assets
		if (sym.length < 2) continue;
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
			// Unstaking returns your own coins — counts as a holding event
			lastPurchaseMap.set(sym, row.timestamp_utc);
			purchasedEverMap.set(sym, true);
		} else if (dir === 'in') {
			// Guard: skip inflows where implied price-per-coin is < 1% of the
			// per-symbol maximum — catches qty/price CSV confusion (e.g. BTC
			// price recorded as coin count, inflating balance by ~77,000x).
			const usdRaw = parseNum(row.native_usd);
			const maxPrice = maxImpliedPrice.get(sym);
			if (maxPrice && usdRaw && usdRaw > 0 && qty > 0) {
				const implied = Math.abs(usdRaw) / qty;
				if (implied < maxPrice * 0.01) continue;
			}

			balanceMap.set(sym, (balanceMap.get(sym) ?? 0) + qty);

			if (kindLower === 'staking income') {
				// Staking income is ordinary income, not a purchase — don't let it
				// reset the holding-period clock used for long-term capital gains tracking.
				addToSet(earnedKindsMap, sym, 'staking');
			} else if (kindLower === 'airdrop') {
				// Airdrops start their own holding period from the drop date.
				lastPurchaseMap.set(sym, row.timestamp_utc);
				addToSet(earnedKindsMap, sym, 'airdrop');
			} else if (kindLower.includes('learning reward') || kindLower.includes('coinbase earn')) {
				// Coinbase Earn / learning rewards start their own holding period.
				lastPurchaseMap.set(sym, row.timestamp_utc);
				addToSet(earnedKindsMap, sym, 'learning');
			} else if (kindLower.includes('sell_lock') || kindLower.includes('sell_unlock')) {
				// A cancelled limit-sell order returns coins to the account — this is NOT
				// a new purchase.  The original holding period must be preserved.
				purchasedEverMap.set(sym, true); // still counts as "ever purchased"
			} else {
				// Regular buy, receive, convert, etc. — real purchase.
				lastPurchaseMap.set(sym, row.timestamp_utc);
				purchasedEverMap.set(sym, true);
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

		const hasPurchase  = purchasedEverMap.get(sym) === true;
		const earnedKinds  = earnedKindsMap.get(sym) ?? new Set<string>();
		const earnedSymbol = hasPurchase ? null : resolveEarnedSymbol(earnedKinds);

		const lots = lotsMap.get(sym) ?? [];
		out.push({
			symbol: sym,
			balance: Math.max(0, bal),
			staked,
			stakingYtd,
			stakingYtdUsd: stakingYtdUsdMap.has(sym) ? (stakingYtdUsd ?? 0) : null,
			// For staking-only coins the lastSeenMap fallback would show the age of the
		// most recent staking reward — a misleading and constantly-shifting number.
		// Suppress it so the UI shows just ⚡ without a confusing days count.
		lastPurchaseAt: earnedSymbol === '⚡'
			? null
			: (lastPurchaseMap.get(sym) ?? lastSeenMap.get(sym) ?? null),
			earnedSymbol,
			costBasis: unknownCost.has(sym) || !lots.length ? null : lots.reduce((s, l) => s + l.cost, 0),
		});
	}
	return out.sort((a, b) => (b.balance + b.staked) - (a.balance + a.staked));
}
