/**
 * Almstins Verify: the satoshi test's exact amount (rule `bound_v1`).
 *
 * Every self-send challenge carries a random EXACT amount. That amount is what binds a
 * transaction to one challenge: a routine send from the address can't satisfy it, and
 * two accounts testing the same address never hold the same pending amount (the partial
 * unique index on (canonical_address, expected_amount) WHERE status = 'pending' enforces
 * that in the DB; see verifyRegistry.ts).
 *
 * The amount is four random digits (1000-9999) scaled per chain, and is always kept in
 * base units as a BigInt string, never a float:
 *
 *   bitcoin                          1,000-9,999 sats                 0.0000abcd BTC
 *   litecoin                         100,000-999,900 litoshis         0.00abcd LTC
 *   ethereum / polygon / avalanche   abcd x 10^10 wei                 0.0000abcd ETH / POL / AVAX
 *   solana                           abcd x 10 lamports               0.0000abcd SOL
 *
 * The amount must not be selectable: nobody may draw again and again until it matches a
 * transaction the owner already made. planIssue() below holds that policy (no reroll
 * within an amount's window, capped new draws, and a small per-account share of each
 * address's pool).
 *
 * Pure: no DB, no network. The DB allocation loop lives in verifyRegistry.ts and passes
 * its insert to allocateTestAmount() as `tryClaim`.
 */
import { randomInt } from 'crypto';

export interface TestAmountSpec {
  /** The chain's native coin, the only thing the test may be sent in. */
  unit: string;
  /** Base units per coin = 10^decimals. */
  decimals: number;
  /** Base units per step of the four random digits. */
  step: bigint;
  /** Decimals shown, so every amount has the same shape (0.0000abcd, 0.00abcd for LTC). */
  displayDecimals: number;
  /** Base-unit name shown next to the coin amount on UTXO chains; null elsewhere. */
  baseUnit: string | null;
}

const EVM_STEP = 10_000_000_000n; // 10^10 wei: abcd x 10^10 wei = 0.0000abcd of the coin

const SPECS: Record<string, TestAmountSpec> = {
  bitcoin: { unit: 'BTC', decimals: 8, step: 1n, displayDecimals: 8, baseUnit: 'sats' },
  litecoin: { unit: 'LTC', decimals: 8, step: 100n, displayDecimals: 6, baseUnit: 'litoshis' },
  ethereum: { unit: 'ETH', decimals: 18, step: EVM_STEP, displayDecimals: 8, baseUnit: null },
  polygon: { unit: 'POL', decimals: 18, step: EVM_STEP, displayDecimals: 8, baseUnit: null },
  avalanche: { unit: 'AVAX', decimals: 18, step: EVM_STEP, displayDecimals: 8, baseUnit: null },
  solana: { unit: 'SOL', decimals: 9, step: 10n, displayDecimals: 8, baseUnit: null },
};

const EVM_RAILS = new Set(['ethereum', 'polygon', 'avalanche']);

/** The four random digits: 1000-9999 inclusive. */
export const DIGITS_MIN = 1000;
export const DIGITS_MAX = 9999;
const DIGITS_SPAN = DIGITS_MAX - DIGITS_MIN + 1;

/**
 * Dust floors, in base units. Every issued amount must be at or above its chain's floor,
 * or the node would refuse to relay the test output.
 *   - Bitcoin: 546 sats is the P2PKH dust limit at the default dust relay fee (P2WPKH is
 *     294), so the 1,000-sat minimum clears every standard output type.
 *   - Litecoin: 0.001 LTC (100,000 litoshis) is the old Litecoin soft dust limit, the most
 *     conservative figure Litecoin has used. The LTC floor is raised on purpose so the
 *     minimum amount (0.001000 LTC) sits exactly on it. Confirm against a live node in the
 *     PR-0 mainnet run.
 * Account chains (EVM, Solana) have no dust rule for a native transfer.
 */
export const BTC_DUST_FLOOR_SATS = 546n;
export const LTC_DUST_FLOOR_LITOSHIS = 100_000n;
const DUST_FLOOR: Record<string, bigint> = {
  bitcoin: BTC_DUST_FLOOR_SATS,
  litecoin: LTC_DUST_FLOOR_LITOSHIS,
};

/** The amount spec for a rail, or null when the satoshi test doesn't support it. */
export function testAmountSpec(rail: string): TestAmountSpec | null {
  return SPECS[rail] ?? null;
}

/** True when `base` clears the rail's dust floor (always true on account chains). */
export function isAboveDustFloor(rail: string, base: bigint): boolean {
  const floor = DUST_FLOOR[rail];
  return floor === undefined ? base > 0n : base >= floor;
}

/**
 * Base units to a plain decimal string with a dot, trailing zeros trimmed, never an
 * exponent: formatBaseUnits(1234n, 8) === '0.00001234'. The UI copies this exact string.
 */
export function formatBaseUnits(base: bigint, decimals: number): string {
  if (decimals <= 0) return base.toString();
  const negative = base < 0n;
  const s = (negative ? -base : base).toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, '');
  const out = frac ? `${whole}.${frac}` : whole;
  return negative ? `-${out}` : out;
}

/**
 * A test amount as the merchant copies it: dot decimal, padded to the rail's fixed shape
 * so a trailing zero digit still shows (1,150 sats is '0.00001150', not '0.0000115').
 * Exact: the step guarantees no digit beyond displayDecimals.
 */
export function formatTestAmount(rail: string, base: bigint): string {
  const spec = testAmountSpec(rail);
  if (!spec) return base.toString();
  const [whole, frac = ''] = formatBaseUnits(base, spec.decimals).split('.');
  return `${whole}.${frac.padEnd(spec.displayDecimals, '0')}`;
}

export interface TestAmount {
  rail: string;
  /** Exact amount in base units (sats, litoshis, wei, lamports), as a BigInt string. */
  base: string;
  /** The same amount in the native coin, dot decimal, e.g. '0.00001234'. */
  display: string;
  unit: string;
  baseUnit: string | null;
}

export function buildTestAmount(rail: string, base: bigint): TestAmount | null {
  const spec = testAmountSpec(rail);
  if (!spec) return null;
  return {
    rail,
    base: base.toString(),
    display: formatTestAmount(rail, base),
    unit: spec.unit,
    baseUnit: spec.baseUnit,
  };
}

/** Random integer in [min, maxExclusive). Injectable so tests can force collisions. */
export type DigitsRng = (min: number, maxExclusive: number) => number;

const RANDOM_TRIES = 32;

/**
 * Draw a random exact amount for `rail` that isn't in `excluded` (base-unit strings:
 * the address's pending amounts, this tenant's amounts from the last 7 days, and a few
 * recent ones per other tenant; see recentPerTenant). Random draws first; if the range
 * is nearly full (never expected in practice) walk it from a random start. Returns null
 * for an unsupported rail or when every amount is excluded.
 */
export function pickTestAmount(
  rail: string,
  excluded: ReadonlySet<string>,
  rng: DigitsRng = randomInt,
): TestAmount | null {
  const spec = testAmountSpec(rail);
  if (!spec) return null;
  const at = (digits: number) => BigInt(digits) * spec.step;
  for (let i = 0; i < RANDOM_TRIES; i++) {
    const base = at(rng(DIGITS_MIN, DIGITS_MAX + 1));
    if (!excluded.has(base.toString())) return buildTestAmount(rail, base);
  }
  const start = rng(DIGITS_MIN, DIGITS_MAX + 1) - DIGITS_MIN;
  for (let k = 0; k < DIGITS_SPAN; k++) {
    const base = at(DIGITS_MIN + ((start + k) % DIGITS_SPAN));
    if (!excluded.has(base.toString())) return buildTestAmount(rail, base);
  }
  return null;
}

/**
 * Pick an amount and try to claim it; on a collision (tryClaim returns false, i.e. the
 * pending-amount unique index rejected it because a concurrent challenge took the same
 * amount) exclude it and draw again. Returns the claimed amount, or null after
 * `maxAttempts` collisions or when nothing is left to draw.
 */
export async function allocateTestAmount(
  rail: string,
  excluded: Iterable<string>,
  tryClaim: (amount: TestAmount) => Promise<boolean>,
  opts: { rng?: DigitsRng; maxAttempts?: number } = {},
): Promise<TestAmount | null> {
  const taken = new Set(excluded);
  const maxAttempts = opts.maxAttempts ?? 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const amount = pickTestAmount(rail, taken, opts.rng);
    if (!amount) return null;
    if (await tryClaim(amount)) return amount;
    taken.add(amount.base);
  }
  return null;
}

// ── Issuance policy ──────────────────────────────────────────────────────────
//
// Every NEW amount a tenant draws is logged per (tenant, canonical address), and that log
// outlives the destination. So deleting and re-adding a destination can't reroll the
// amount: while an amount the tenant drew for the address is unexpired, the tenant gets
// THAT amount back (same window). New draws are also capped per address and per tenant.
// And no tenant can use up an address's pool (9,000 amounts): another tenant's history
// only reserves its OTHER_TENANT_HOLD_MAX most recent amounts there.

/** New amounts one tenant may draw for one address in a rolling 24h. */
export const MAX_NEW_PER_ADDRESS_24H = 3;
/** New amounts one tenant may draw across all its addresses in a rolling 24h. */
export const MAX_NEW_PER_TENANT_24H = 10;
/** How many of another tenant's recent amounts are kept off-limits on an address. Equal
 *  to the per-address cap, so every unexpired amount a tenant holds stays reserved. */
export const OTHER_TENANT_HOLD_MAX = MAX_NEW_PER_ADDRESS_24H;
const LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** One amount this tenant drew for the address (from its issuance log). */
export interface OwnDraw {
  amount: string;
  issuedAtMs: number;
  expiresAtMs: number;
  /** False when the row can't be issued again as is (say, a BTC/LTC draw with no baseline). */
  reusable: boolean;
}

export interface IssuePlan {
  /** An unexpired amount this tenant already drew for the address that no pending test
   *  holds now: issue it again, with its original window. Never a new draw while one exists. */
  reuse: OwnDraw | null;
  /** Whether a NEW amount may be drawn now (both caps). */
  canDraw: boolean;
  /** When a new draw is next allowed, if it isn't now (epoch ms). */
  retryAtMs: number | null;
}

/**
 * Decide how to answer "I'm ready to send" when the destination has no active test.
 * `own` is this tenant's draws for this address (any age the log keeps); `tenantDraws`
 * is when this tenant drew for ANY address; `held` is every amount pending on this
 * address right now, any tenant.
 */
export function planIssue(input: {
  own: OwnDraw[];
  tenantDraws: number[];
  held: ReadonlySet<string>;
  nowMs: number;
}): IssuePlan {
  const { own, tenantDraws, held, nowMs } = input;
  const since = nowMs - LIMIT_WINDOW_MS;
  // When the oldest draw that keeps the count at `max` leaves the window; null = under the cap.
  const reopensAt = (times: number[], max: number): number | null => {
    const recent = times.filter((t) => t > since).sort((a, b) => a - b);
    return recent.length >= max ? recent[recent.length - max] + LIMIT_WINDOW_MS : null;
  };
  const addressAt = reopensAt(own.map((d) => d.issuedAtMs), MAX_NEW_PER_ADDRESS_24H);
  const tenantAt = reopensAt(tenantDraws, MAX_NEW_PER_TENANT_24H);
  const canDraw = addressAt === null && tenantAt === null;
  const reuse = own
    .filter((d) => d.reusable && nowMs <= d.expiresAtMs && !held.has(d.amount))
    .sort((a, b) => b.issuedAtMs - a.issuedAtMs)[0] ?? null;
  return { reuse, canDraw, retryAtMs: canDraw ? null : Math.max(addressAt ?? 0, tenantAt ?? 0) };
}

/**
 * Other tenants' logged amounts on an address, keeping only each tenant's `max` most
 * recent. This is what stops one account (or a script) from filling the pool and locking
 * the real owner out; the pending-amount unique index still guards every live test.
 */
export function recentPerTenant(
  rows: Array<{ tenantId: string; amount: string; issuedAtMs: number }>,
  max: number = OTHER_TENANT_HOLD_MAX,
): Set<string> {
  const byTenant = new Map<string, Array<{ amount: string; issuedAtMs: number }>>();
  for (const r of rows) {
    const list = byTenant.get(r.tenantId) ?? [];
    list.push(r);
    byTenant.set(r.tenantId, list);
  }
  const out = new Set<string>();
  for (const list of byTenant.values()) {
    list.sort((a, b) => b.issuedAtMs - a.issuedAtMs);
    for (const r of list.slice(0, max)) out.add(r.amount);
  }
  return out;
}

const BECH32_PREFIX = /^(bc1|tb1|bcrt1|ltc1|tltc1)/i;

/** True when letter case doesn't change the address (EVM hex, bech32 / bech32m). */
export function isCaselessAddress(rail: string, value: string): boolean {
  return EVM_RAILS.has(rail) || BECH32_PREFIX.test(String(value ?? '').trim());
}

/**
 * Canonical identity of an address for amount uniqueness across tenants.
 *   - EVM: 'evm:' + lowercase, shared by all three EVM rails (the same key controls the
 *     address on each, so a pending amount is reserved across the family).
 *   - bech32 / bech32m (bc1, tb1, bcrt1, ltc1, tltc1): lowercase (the encoding is
 *     case-insensitive).
 *   - base58 (legacy BTC/LTC, Solana): exactly as entered (case-sensitive).
 * Same rule the plan gives PR-2 for the destination's canonical value.
 */
export function canonicalAddress(rail: string, value: string): string {
  const v = String(value ?? '').trim();
  if (EVM_RAILS.has(rail)) return `evm:${v.toLowerCase()}`;
  if (BECH32_PREFIX.test(v)) return v.toLowerCase();
  return v;
}
