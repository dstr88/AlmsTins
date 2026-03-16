/**
 * classify.ts — Pure, side-effect-free Aave transaction classification.
 *
 * Tax logic reference (US IRS / DeFi best practices 2024-2026):
 *   - Borrows            → NOT taxable. No cost-basis lot created.
 *   - Repayments         → NOT taxable (returning principal of same asset).
 *   - Collateral supply  → NOT taxable (no disposition; aToken is just receipt).
 *   - Collateral withdraw → NOT taxable (reclaiming own asset, no new cost basis).
 *   - Flash loans        → NOT taxable (borrow + repay in one atomic tx).
 *   - Forced liquidation → TAXABLE disposal. Treated as a forced sale of collateral.
 *                          Gain/loss = FMV at liquidation − original cost basis.
 *                          (Auto-detection requires event-log data; see note below.)
 *   - Lending interest   → Taxable ordinary INCOME when received.
 *                          (aToken rebasing is invisible to token-transfer APIs;
 *                           detected only on explicit aToken balance-increase events.)
 *
 * This module is intentionally free of DB/network imports so it can be unit-tested
 * without mocking.  lifecycle.ts imports from here.
 */

// ---------------------------------------------------------------------------
// Transaction class taxonomy
// ---------------------------------------------------------------------------

export type TransactionClass =
	| 'owned_acquisition'   // Taxable purchase / receipt — creates a FIFO buy lot
	| 'liability_increase'  // Aave borrow — NOT taxable, no buy lot
	| 'liability_repayment' // Aave repay  — NOT taxable
	| 'liability_liquidation' // Forced collateral seizure — IS taxable (forced sell)
	| 'collateral_deposit'    // Token → aToken swap (supply) — NOT taxable
	| 'collateral_withdrawal' // aToken → Token swap (withdraw) — NOT taxable
	| 'interest_income'       // Lending yield received  — taxable ordinary income
	| 'other';               // Unclassified / regular transfer

// ---------------------------------------------------------------------------
// Aave pool contract addresses (all lowercase, multi-chain)
// ---------------------------------------------------------------------------

/**
 * Canonical Aave V2 + V3 pool/lending-pool-proxy addresses.
 * Used to identify borrows (IN from pool) and repayments (OUT to pool).
 *
 * Ethereum V2  : 0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9
 * Ethereum V3  : 0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2
 * Polygon  V2  : 0x8dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf
 * Polygon  V3  : 0x794a61358d6845594f94dc1db02a252b5b4814ad (shared with Avalanche)
 * Avalanche V3 : 0x794a61358d6845594f94dc1db02a252b5b4814ad
 */
export const AAVE_POOL_ADDRESSES = new Set<string>([
	'0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9', // Ethereum V2
	'0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', // Ethereum V3
	'0x8dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf', // Polygon V2
	'0x794a61358d6845594f94dc1db02a252b5b4814ad', // Polygon V3 / Avalanche V3
]);

// ---------------------------------------------------------------------------
// aToken symbol detection
// ---------------------------------------------------------------------------

/**
 * Tokens explicitly excluded from aToken detection despite starting with 'A'.
 * Covers mainstream assets and the AAVE protocol token itself.
 */
const ATOKEN_EXCLUSIONS = new Set([
	'AAVE', 'AVAX', 'ADA', 'ALGO', 'APE', 'ARB', 'APT', 'ATOM',
	'ANKR', 'AXS', 'AUDIO', 'AGLD', 'ACH', 'ALICE', 'ALPHA', 'ARPA',
]);

/**
 * Returns true when `symbol` looks like an Aave aToken.
 *
 * Known patterns:
 *   V2 Ethereum : aUSDC, aWETH, aDAI, aWBTC, aUSDT, aLINK …
 *   V2 Polygon  : amUSDC, amWMATIC, amWETH …
 *   V3 Ethereum : aEthUSDC, aEthWETH …
 *   V3 Polygon  : aPolUSDC, aPolWMATIC …
 *   V3 Avalanche: aAvaUSDC, aAvaWAVAX …
 *   V3 Arbitrum : aArbUSDC, aArbWETH …
 *   V3 Optimism : aOptUSDC, aOptWETH …
 *
 * Debt tokens (variableDebtXXX, stableDebtXXX) are handled separately.
 */
export function isAaveAToken(symbol: string): boolean {
	const s = symbol.toUpperCase();
	if (ATOKEN_EXCLUSIONS.has(s)) return false;
	if (s.startsWith('AAVE')) return false; // AAVE token itself
	// Must start with 'A' (optionally followed by known chain infix) then ≥1 uppercase letter
	return /^A(?:M|ETH|POL|AVA|ARB|OPT)?[A-Z]/.test(s);
}

/**
 * Returns true when `symbol` is an Aave variable or stable debt token.
 * These are non-transferable (soul-bound) in V3, but may appear in V2 logs.
 */
export function isAaveDebtToken(symbol: string): boolean {
	const s = symbol.toLowerCase();
	return s.startsWith('variabledebt') || s.startsWith('stabledebt');
}

// ---------------------------------------------------------------------------
// Minimal row shape needed for classification
// ---------------------------------------------------------------------------

export interface ClassifyRow {
	id: string;
	symbol: string;          // Already normalised (uppercase, NATIVE → chain symbol)
	direction: string | null; // 'in' | 'out' | null
	fromAddress: string | null;
	toAddress: string | null;
}

// ---------------------------------------------------------------------------
// Core classifier
// ---------------------------------------------------------------------------

/**
 * Classifies a single onchain token-transfer row in the context of all other
 * transfers sharing the same transaction hash (the "group").
 *
 * Decision tree
 * ─────────────
 * 1.  aToken IN              → collateral_deposit   (received aToken = supplied collateral)
 * 2.  aToken OUT             → collateral_withdrawal (burned aToken = withdrew collateral)
 * 3.  Debt token             → liability_increase / liability_repayment accordingly
 * 4.  Flash loan             → 'other'              (IN + OUT of same symbol/pool, same tx)
 * 5.  IN from Aave pool + aToken OUT sibling
 *                            → collateral_withdrawal (get underlying back; aToken burned)
 * 6.  IN from Aave pool, no aToken sibling
 *                            → liability_increase    (borrow)
 * 7.  OUT to Aave pool + aToken IN sibling
 *                            → collateral_deposit    (supply; aToken received)
 * 8.  OUT to Aave pool, no aToken sibling
 *                            → liability_repayment   (repay debt)
 * 9.  Everything else        → 'other'
 *
 * ⚠ Liquidation auto-detection requires on-chain event logs (LiquidationCall event)
 *   and is NOT implemented here.  Mark those transactions as 'liability_liquidation'
 *   manually or via a separate log-sync pipeline.
 */
export function classifyOnchainTxWithContext(
	row: ClassifyRow,
	group: ClassifyRow[], // All rows sharing the same tx_hash (including `row` itself)
): TransactionClass {
	const { symbol, direction, fromAddress, toAddress } = row;

	const from = (fromAddress ?? '').toLowerCase();
	const to   = (toAddress   ?? '').toLowerCase();

	// ── 1 & 2: aToken transfers ──────────────────────────────────────────────
	if (isAaveAToken(symbol)) {
		if (direction === 'in')  return 'collateral_deposit';
		if (direction === 'out') return 'collateral_withdrawal';
		return 'other';
	}

	// ── 3: Debt token transfers ───────────────────────────────────────────────
	if (isAaveDebtToken(symbol)) {
		if (direction === 'in')  return 'liability_increase';
		if (direction === 'out') return 'liability_repayment';
		return 'other';
	}

	const fromIsPool = AAVE_POOL_ADDRESSES.has(from);
	const toIsPool   = AAVE_POOL_ADDRESSES.has(to);

	// No Aave pool involvement → regular transfer
	if (!fromIsPool && !toIsPool) return 'other';

	// Siblings = other rows in the same transaction
	const siblings = group.filter((s) => s.id !== row.id);

	// ── 4: Flash loan detection ───────────────────────────────────────────────
	// A flash loan appears as IN-from-pool AND OUT-to-pool of the same symbol,
	// in the same transaction.  Both legs cancel out → non-taxable.
	const hasReversePoolTransfer = siblings.some((s) => {
		if (s.symbol !== symbol) return false;
		const sFrom = (s.fromAddress ?? '').toLowerCase();
		const sTo   = (s.toAddress   ?? '').toLowerCase();
		if (direction === 'in')  return s.direction === 'out' && AAVE_POOL_ADDRESSES.has(sTo);
		if (direction === 'out') return s.direction === 'in'  && AAVE_POOL_ADDRESSES.has(sFrom);
		return false;
	});
	if (hasReversePoolTransfer) return 'other'; // flash loan — both legs in same atomic tx

	// Check whether the same tx has an aToken transfer (disambiguates supply ↔ repay,
	// and withdraw ↔ borrow)
	const hasATokenSibling = siblings.some((s) => isAaveAToken(s.symbol));

	// ── 5 & 6: IN from pool ───────────────────────────────────────────────────
	if (direction === 'in' && fromIsPool) {
		// Paired aToken burn in same tx → user withdrew collateral (got underlying back)
		return hasATokenSibling ? 'collateral_withdrawal' : 'liability_increase';
	}

	// ── 7 & 8: OUT to pool ────────────────────────────────────────────────────
	if (direction === 'out' && toIsPool) {
		// Paired aToken mint in same tx → user supplied collateral
		return hasATokenSibling ? 'collateral_deposit' : 'liability_repayment';
	}

	return 'other';
}

// ---------------------------------------------------------------------------
// FIFO exclusion helper
// ---------------------------------------------------------------------------

/**
 * Classes that are EXCLUDED from FIFO cost-basis matching.
 *
 * 'liability_liquidation' is intentionally absent — a forced sale IS a taxable
 * disposal and must participate in FIFO as a sell event.
 *
 * 'interest_income' is excluded from FIFO (it feeds an income line, not P/L).
 */
export const FIFO_EXCLUDED_CLASSES = new Set<TransactionClass>([
	'liability_increase',
	'liability_repayment',
	'collateral_deposit',
	'collateral_withdrawal',
	'interest_income',
]);
