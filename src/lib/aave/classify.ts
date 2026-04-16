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
 *   - Lending interest   → Taxable ordinary INCOME when received.
 *                          Detected via two signals:
 *                            (a) aToken mint FROM zero address WITHOUT a paired
 *                                underlying-token deposit in the same tx (accrual event)
 *                            (b) LiquidationCall log in the receipt — used only for
 *                                reclassifying collateral outflows as liability_liquidation
 *
 * This module is intentionally free of DB/network imports so it can be unit-tested
 * without mocking.  lifecycle.ts and events.ts import from here.
 *
 * Dependency graph (no cycles):
 *   classify.ts  ← events.ts  ← lifecycle.ts
 */

// ---------------------------------------------------------------------------
// Transaction class taxonomy
// ---------------------------------------------------------------------------

export type TransactionClass =
	| 'owned_acquisition'     // Taxable purchase / receipt — creates a FIFO buy lot
	| 'liability_increase'    // Aave borrow — NOT taxable, no buy lot
	| 'liability_repayment'   // Aave repay  — NOT taxable
	| 'liability_liquidation' // Forced collateral seizure — IS taxable (forced sell)
	| 'collateral_deposit'    // Token → aToken swap (supply) — NOT taxable
	| 'collateral_withdrawal' // aToken → Token swap (withdraw) — NOT taxable
	| 'interest_income'       // Lending yield received — taxable ordinary income
	| 'other';                // Unclassified / regular transfer

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
	// ── V2 ───────────────────────────────────────────────────────────────────
	'0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9', // Ethereum V2 LendingPool
	'0x8dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf', // Polygon V2 LendingPool
	'0x4f01aed16d97e3ab5ab2b501154dc9bb0f1a5a2c', // Avalanche V2 LendingPool
	// ── V3 ───────────────────────────────────────────────────────────────────
	'0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', // Ethereum V3 Pool
	'0x794a61358d6845594f94dc1db02a252b5b4814ad', // Polygon V3 / Avalanche V3 / Arbitrum V3 / Optimism V3
	'0x8145edddf43f50276641b55bd3ad95944510021e', // Avalanche V3 Pool (alternate proxy)
	// ── Gateways (ETH/AVAX native → WETH/WAVAX, sent to these before the pool) ─
	'0xcc9a0b7c43dc2a5f023bb9b738e45b0ef6f4bf0e', // V2 ETH Gateway (Ethereum)
	'0x1c91347f2a44538ce62ef789017b69f63b8a99a6', // V2 WETH Gateway (Avalanche)
]);

/** The Ethereum zero address — used to detect aToken mint (interest accrual). */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Ray = 1e27 — Aave's fixed-point precision unit used for liquidityIndex.
 *
 * All Aave V3 liquidity indices are stored and emitted in ray precision:
 *   realBalance = scaledBalance × liquidityIndex / RAY
 *   interest    = withdrawAmount × (withdrawIndex − supplyIndex) / withdrawIndex
 */
export const RAY = BigInt('1000000000000000000000000000');

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
 */
export function isAaveAToken(symbol: string): boolean {
	const s = symbol.toUpperCase();
	if (ATOKEN_EXCLUSIONS.has(s)) return false;
	if (s.startsWith('AAVE')) return false;
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
// Parsed Aave event types (produced by events.ts, consumed by classify)
// Defined here so classify.ts stays import-free and fully testable.
// ---------------------------------------------------------------------------

export type LiquidationCallEvent = {
	type: 'LiquidationCall';
	/** ERC-20 contract address of the seized collateral */
	collateralAsset: string;
	/** ERC-20 contract address of the debt repaid by the liquidator */
	debtAsset: string;
	/** Wallet address that was liquidated (must match a tracked wallet) */
	user: string;
	debtToCover: bigint;
	liquidatedCollateralAmount: bigint;
	liquidator: string;
	receiveAToken: boolean;
	txHash: string;
};

/**
 * Aave Supply event (V3) / Deposit event (V2).
 *
 * Emitted by the Pool contract when a user supplies liquidity.
 *   topics[1] → reserve    (indexed address — the underlying token, e.g. USDC)
 *   topics[2] → onBehalfOf (indexed address — wallet that receives the aToken)
 *   topics[3] → referralCode (indexed uint16)
 *   data[0]   → user       (non-indexed address — the tx caller)
 *   data[1]   → amount     (uint256 — in underlying units)
 */
export type AaveSupplyEvent = {
	type:          'Supply';
	poolAddress:   string;   // pool contract that emitted the event (log.address)
	reserve:       string;   // underlying asset address (e.g. USDC contract)
	onBehalfOf:    string;   // wallet that received the aToken
	user:          string;   // tx caller (may differ from onBehalfOf)
	amount:        bigint;   // underlying units at supply time
	blockNumber:   number;   // block at which the supply occurred
	txHash:        string;
};

/**
 * Aave Withdraw event (V3 + V2 LendingPool).
 *
 * Emitted when a user withdraws collateral from the pool.
 *   topics[1] → reserve (indexed)
 *   topics[2] → user    (indexed — wallet initiating the withdrawal)
 *   topics[3] → to      (indexed — recipient, usually same as user)
 *   data[0]   → amount  (uint256 — underlying units; includes accrued interest)
 */
export type AaveWithdrawEvent = {
	type:        'Withdraw';
	poolAddress: string;   // pool contract
	reserve:     string;   // underlying asset address
	user:        string;   // wallet that withdrew
	to:          string;   // recipient (often same as user)
	amount:      bigint;   // underlying units received (principal + interest)
	blockNumber: number;
	txHash:      string;
};

/** Union of all parsed Aave events — extend as new event types are added. */
export type ParsedAaveEvent = LiquidationCallEvent | AaveSupplyEvent | AaveWithdrawEvent;

// ---------------------------------------------------------------------------
// Rebasing interest helpers
// ---------------------------------------------------------------------------

/**
 * Compute the interest component of an Aave V3 withdrawal.
 *
 * Derivation:
 *   scaledBalance = depositAmount × RAY / supplyIndex
 *   fullBalance   = scaledBalance × withdrawIndex / RAY
 *   interest      = fullBalance − depositAmount
 *               = depositAmount × (withdrawIndex − supplyIndex) / supplyIndex
 *
 * For partial withdrawals with a known withdrawAmount:
 *   interest = withdrawAmount × (withdrawIndex − supplyIndex) / withdrawIndex
 *
 * @param withdrawAmount  Amount of underlying received (raw units — from the tx)
 * @param supplyIndex     liquidityIndex at deposit block (ray, 1e27-scale)
 * @param withdrawIndex   liquidityIndex at withdrawal block (ray)
 * @returns               Interest portion of withdrawAmount (raw units, ≥ 0)
 */
export function computeRebasingInterest(
	withdrawAmount: bigint,
	supplyIndex:    bigint,
	withdrawIndex:  bigint,
): bigint {
	if (withdrawIndex <= supplyIndex || withdrawAmount === 0n || withdrawIndex === 0n) return 0n;
	return (withdrawAmount * (withdrawIndex - supplyIndex)) / withdrawIndex;
}

// ---------------------------------------------------------------------------
// Minimal row shape needed for classification
// ---------------------------------------------------------------------------

export interface ClassifyRow {
	id: string;
	symbol:      string;       // Already normalised (uppercase, NATIVE → chain symbol)
	direction:   string | null; // 'in' | 'out' | null
	fromAddress: string | null;
	toAddress:   string | null;
}

// ---------------------------------------------------------------------------
// Core classifier
// ---------------------------------------------------------------------------

/**
 * Classifies a single onchain token-transfer row using:
 *   (a) sibling transfers in the same tx (group context)
 *   (b) optional parsed Aave event logs from the tx receipt
 *
 * Decision tree — evaluated in priority order
 * ───────────────────────────────────────────
 * [EVENT-BASED — highest confidence]
 * 0a. LiquidationCall event present + aToken OUT from user → liability_liquidation
 * 0b. LiquidationCall event present + non-aToken OUT not to pool → liability_liquidation
 *
 * [TRANSFER-PATTERN]
 * 1.  aToken IN from zero address (0x0), no underlying OUT to pool sibling
 *                            → interest_income  (accrual mint)
 * 2.  aToken IN from zero address, WITH underlying OUT to pool sibling
 *                            → collateral_deposit (initial deposit receipt)
 * 3.  aToken IN from non-zero → collateral_deposit
 * 4.  aToken OUT             → collateral_withdrawal (burned on withdraw)
 * 5.  Debt token IN          → liability_increase
 * 6.  Debt token OUT         → liability_repayment
 * 7.  Flash loan (IN + OUT same symbol/pool, same tx) → 'other'
 * 8.  IN from pool + aToken OUT sibling → collateral_withdrawal
 * 9.  IN from pool, no aToken sibling   → liability_increase (borrow)
 * 10. OUT to pool + aToken IN sibling   → collateral_deposit (supply)
 * 11. OUT to pool, no aToken sibling    → liability_repayment (repay)
 * 12. Everything else        → 'other'
 */
export function classifyOnchainTxWithContext(
	row: ClassifyRow,
	group: ClassifyRow[],          // All rows sharing the same tx_hash (including `row`)
	events?: ParsedAaveEvent[],    // Parsed Aave logs from eth_getTransactionReceipt
): TransactionClass {
	const { symbol, direction, fromAddress, toAddress } = row;

	const from = (fromAddress ?? '').toLowerCase();
	const to   = (toAddress   ?? '').toLowerCase();

	// Siblings = all other rows in the same transaction
	const siblings = group.filter((s) => s.id !== row.id);

	// ── 0: Event-log based liquidation detection (highest confidence) ─────────
	const liquidationCall = events?.find((e) => e.type === 'LiquidationCall');
	if (liquidationCall) {
		// aToken going out in a liquidation tx → seized collateral receipt burned
		if (isAaveAToken(symbol) && direction === 'out') {
			return 'liability_liquidation';
		}
		// Underlying collateral going OUT to the liquidator (not to pool)
		if (!isAaveAToken(symbol) && direction === 'out' && !AAVE_POOL_ADDRESSES.has(to)) {
			return 'liability_liquidation';
		}
	}

	// ── 1–4: aToken transfers ─────────────────────────────────────────────────
	if (isAaveAToken(symbol)) {
		if (direction === 'in') {
			// From the zero address = explicit mint event
			if (from === ZERO_ADDRESS) {
				// If the same tx has underlying going OUT to an Aave pool, this mint
				// is the aToken receipt for a deposit (not an interest accrual event).
				const hasDepositSibling = siblings.some((s) => {
					const sTo = (s.toAddress ?? '').toLowerCase();
					return (
						!isAaveAToken(s.symbol) &&
						s.direction === 'out' &&
						AAVE_POOL_ADDRESSES.has(sTo)
					);
				});
				return hasDepositSibling ? 'collateral_deposit' : 'interest_income';
			}
			return 'collateral_deposit'; // from any other address
		}
		if (direction === 'out') return 'collateral_withdrawal';
		return 'other';
	}

	// ── 5–6: Debt token transfers ─────────────────────────────────────────────
	if (isAaveDebtToken(symbol)) {
		if (direction === 'in')  return 'liability_increase';
		if (direction === 'out') return 'liability_repayment';
		return 'other';
	}

	const fromIsPool = AAVE_POOL_ADDRESSES.has(from);
	const toIsPool   = AAVE_POOL_ADDRESSES.has(to);

	// No Aave pool involvement → regular transfer
	if (!fromIsPool && !toIsPool) return 'other';

	// ── 7: Flash loan detection ───────────────────────────────────────────────
	const hasReversePoolTransfer = siblings.some((s) => {
		if (s.symbol !== symbol) return false;
		const sFrom = (s.fromAddress ?? '').toLowerCase();
		const sTo   = (s.toAddress   ?? '').toLowerCase();
		if (direction === 'in')  return s.direction === 'out' && AAVE_POOL_ADDRESSES.has(sTo);
		if (direction === 'out') return s.direction === 'in'  && AAVE_POOL_ADDRESSES.has(sFrom);
		return false;
	});
	if (hasReversePoolTransfer) return 'other';

	// Disambiguate supply ↔ repay and withdraw ↔ borrow via aToken sibling
	const hasATokenSibling = siblings.some((s) => isAaveAToken(s.symbol));

	// ── 8–9: IN from pool ─────────────────────────────────────────────────────
	if (direction === 'in' && fromIsPool) {
		return hasATokenSibling ? 'collateral_withdrawal' : 'liability_increase';
	}

	// ── 10–11: OUT to pool ────────────────────────────────────────────────────
	if (direction === 'out' && toIsPool) {
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
