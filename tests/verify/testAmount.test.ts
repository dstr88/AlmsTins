import { describe, it, expect, vi } from 'vitest';
import {
  pickTestAmount,
  allocateTestAmount,
  formatBaseUnits,
  formatTestAmount,
  testAmountSpec,
  isAboveDustFloor,
  canonicalAddress,
  isCaselessAddress,
  planIssue,
  recentPerTenant,
  MAX_NEW_PER_ADDRESS_24H,
  MAX_NEW_PER_TENANT_24H,
  OTHER_TENANT_HOLD_MAX,
  BTC_DUST_FLOOR_SATS,
  LTC_DUST_FLOOR_LITOSHIS,
  DIGITS_MIN,
  DIGITS_MAX,
  type DigitsRng,
  type OwnDraw,
} from '../../src/lib/verifyTestAmount';

/**
 * The satoshi test's exact amount (rule bound_v1): four random digits scaled per chain,
 * kept in base units as a BigInt string. These pin the ranges, the dust floor, the
 * display format the merchant copies, and the collision retry that keeps two pending
 * challenges on one address from ever sharing an amount.
 */

/** An rng that returns the given digits in order (then repeats the last). */
function seq(...digits: number[]): DigitsRng {
  let i = 0;
  return (min, maxExclusive) => {
    const d = digits[Math.min(i++, digits.length - 1)];
    expect(min).toBe(DIGITS_MIN);
    expect(maxExclusive).toBe(DIGITS_MAX + 1);
    return d;
  };
}

const RAILS = ['bitcoin', 'litecoin', 'ethereum', 'polygon', 'avalanche', 'solana'] as const;
const none = new Set<string>();

describe('satoshi test amount: ranges per chain', () => {
  const cases: Array<[string, bigint, bigint, string, string]> = [
    // rail, min base, max base, unit, display at digits 1234
    ['bitcoin', 1000n, 9999n, 'BTC', '0.00001234'],
    ['litecoin', 100_000n, 999_900n, 'LTC', '0.001234'],
    ['ethereum', 10_000_000_000_000n, 99_990_000_000_000n, 'ETH', '0.00001234'],
    ['polygon', 10_000_000_000_000n, 99_990_000_000_000n, 'POL', '0.00001234'],
    ['avalanche', 10_000_000_000_000n, 99_990_000_000_000n, 'AVAX', '0.00001234'],
    ['solana', 10_000n, 99_990n, 'SOL', '0.00001234'],
  ];

  for (const [rail, min, max, unit, display1234] of cases) {
    it(`${rail}: 1000-9999 scaled to ${unit} base units, formatted 0.0000abcd style`, () => {
      const lo = pickTestAmount(rail, none, seq(DIGITS_MIN))!;
      const hi = pickTestAmount(rail, none, seq(DIGITS_MAX))!;
      expect(BigInt(lo.base)).toBe(min);
      expect(BigInt(hi.base)).toBe(max);
      expect(lo.unit).toBe(unit);
      expect(pickTestAmount(rail, none, seq(1234))!.display).toBe(display1234);
    });
  }

  it('random draws stay inside the range and are whole base units', () => {
    for (const rail of RAILS) {
      const spec = testAmountSpec(rail)!;
      for (let i = 0; i < 200; i++) {
        const a = pickTestAmount(rail, none)!;
        expect(a.base).toMatch(/^\d+$/);
        const digits = BigInt(a.base) / spec.step;
        expect(BigInt(a.base) % spec.step).toBe(0n);
        expect(digits >= BigInt(DIGITS_MIN) && digits <= BigInt(DIGITS_MAX)).toBe(true);
      }
    }
  });

  it('UTXO chains carry a base-unit name; account chains do not', () => {
    expect(pickTestAmount('bitcoin', none, seq(1234))!.baseUnit).toBe('sats');
    expect(pickTestAmount('litecoin', none, seq(1234))!.baseUnit).toBe('litoshis');
    expect(pickTestAmount('ethereum', none, seq(1234))!.baseUnit).toBeNull();
    expect(pickTestAmount('solana', none, seq(1234))!.baseUnit).toBeNull();
  });

  it('an unsupported rail gets no amount', () => {
    expect(testAmountSpec('tron')).toBeNull();
    expect(pickTestAmount('tron', none)).toBeNull();
    expect(pickTestAmount('url', none)).toBeNull();
  });
});

describe('satoshi test amount: dust floor', () => {
  it('the smallest Bitcoin amount clears the 546-sat dust limit', () => {
    const lo = BigInt(pickTestAmount('bitcoin', none, seq(DIGITS_MIN))!.base);
    expect(lo >= BTC_DUST_FLOOR_SATS).toBe(true);
    expect(isAboveDustFloor('bitcoin', lo)).toBe(true);
    expect(isAboveDustFloor('bitcoin', 545n)).toBe(false);
  });

  it('the smallest Litecoin amount is 0.001 LTC, at the conservative 0.001 LTC floor', () => {
    const lo = BigInt(pickTestAmount('litecoin', none, seq(DIGITS_MIN))!.base);
    expect(lo).toBe(LTC_DUST_FLOOR_LITOSHIS);
    expect(formatBaseUnits(lo, 8)).toBe('0.001');
    expect(isAboveDustFloor('litecoin', lo)).toBe(true);
    expect(isAboveDustFloor('litecoin', LTC_DUST_FLOOR_LITOSHIS - 1n)).toBe(false);
  });

  it('every amount on every chain clears its floor', () => {
    for (const rail of RAILS) {
      expect(isAboveDustFloor(rail, BigInt(pickTestAmount(rail, none, seq(DIGITS_MIN))!.base))).toBe(true);
    }
  });
});

describe('satoshi test amount: formatting', () => {
  it('dot decimal, trailing zeros trimmed, never an exponent', () => {
    expect(formatBaseUnits(1234n, 8)).toBe('0.00001234');
    expect(formatBaseUnits(123_400n, 8)).toBe('0.001234');
    expect(formatBaseUnits(123_000n, 8)).toBe('0.00123');
    expect(formatBaseUnits(12_340_000_000_000n, 18)).toBe('0.00001234');
    expect(formatBaseUnits(12_340n, 9)).toBe('0.00001234');
    expect(formatBaseUnits(100_000_000n, 8)).toBe('1');
    expect(formatBaseUnits(0n, 8)).toBe('0');
    expect(formatBaseUnits(99_990_000_000_000n, 18)).not.toMatch(/e/i);
  });

  it('the copied amount keeps the fixed 0.0000abcd shape, trailing zero included', () => {
    expect(formatTestAmount('bitcoin', 1150n)).toBe('0.00001150');
    expect(formatTestAmount('litecoin', 115_000n)).toBe('0.001150');
    expect(formatTestAmount('ethereum', 1000n * 10n ** 10n)).toBe('0.00001000');
    expect(formatTestAmount('solana', 99_990n)).toBe('0.00009999');
    expect(pickTestAmount('bitcoin', none, seq(1150))!.display).toBe('0.00001150');
    for (const rail of RAILS) {
      const d = pickTestAmount(rail, none)!.display;
      expect(d).toMatch(rail === 'litecoin' ? /^0\.00\d{4}$/ : /^0\.0000\d{4}$/);
    }
  });

  it('display always round-trips to the exact base amount', () => {
    for (const rail of RAILS) {
      const spec = testAmountSpec(rail)!;
      for (let i = 0; i < 50; i++) {
        const a = pickTestAmount(rail, none)!;
        const [whole, frac = ''] = a.display.split('.');
        const back = BigInt(whole + frac.padEnd(spec.decimals, '0'));
        expect(back.toString()).toBe(a.base);
      }
    }
  });
});

describe('satoshi test amount: uniqueness under collision', () => {
  it('skips amounts already taken on this address', () => {
    const taken = new Set(['1234']);
    const a = pickTestAmount('bitcoin', taken, seq(1234, 1234, 5678))!;
    expect(a.base).toBe('5678');
  });

  it('walks the range when random draws keep colliding', () => {
    // Every amount but one is taken; the rng only ever offers a taken one.
    const taken = new Set<string>();
    for (let d = DIGITS_MIN; d <= DIGITS_MAX; d++) if (d !== 4321) taken.add(String(d));
    expect(pickTestAmount('bitcoin', taken, seq(1000))!.base).toBe('4321');
  });

  it('returns null when every amount is taken', () => {
    const taken = new Set<string>();
    for (let d = DIGITS_MIN; d <= DIGITS_MAX; d++) taken.add(String(d));
    expect(pickTestAmount('bitcoin', taken, seq(1000))).toBeNull();
  });

  it('retries with a new amount when the DB insert collides (concurrent challenge)', async () => {
    const tryClaim = vi.fn()
      .mockResolvedValueOnce(false) // unique index: another challenge just took 2222
      .mockResolvedValueOnce(true);
    const got = await allocateTestAmount('bitcoin', ['1111'], tryClaim, { rng: seq(1111, 2222, 2222, 3333) });
    expect(got!.base).toBe('3333');
    expect(tryClaim).toHaveBeenCalledTimes(2);
    expect(tryClaim.mock.calls.map((c) => c[0].base)).toEqual(['2222', '3333']);
  });

  it('gives up after maxAttempts collisions', async () => {
    const tryClaim = vi.fn().mockResolvedValue(false);
    const got = await allocateTestAmount('solana', [], tryClaim, { maxAttempts: 3 });
    expect(got).toBeNull();
    expect(tryClaim).toHaveBeenCalledTimes(3);
    const bases = tryClaim.mock.calls.map((c) => c[0].base);
    expect(new Set(bases).size).toBe(3); // never re-offers a collided amount
  });
});

describe('satoshi test amount: canonical address', () => {
  it('EVM is one lowercase identity across the three EVM rails', () => {
    const a = '0xAbC0000000000000000000000000000000001234';
    const k = canonicalAddress('ethereum', a);
    expect(k).toBe('evm:0xabc0000000000000000000000000000000001234');
    expect(canonicalAddress('polygon', a.toLowerCase())).toBe(k);
    expect(canonicalAddress('avalanche', ` ${a} `)).toBe(k);
  });

  it('bech32 is lowercased; base58 keeps its case', () => {
    expect(canonicalAddress('bitcoin', 'BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ'))
      .toBe('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    expect(canonicalAddress('litecoin', 'LTC1QG9STKXRSZKDQSUJ4GR3EZCRRWE8H8F8VVNFL8N'))
      .toBe('ltc1qg9stkxrszkdqsuj4gr3ezcrrwe8h8f8vvnfl8n');
    expect(canonicalAddress('bitcoin', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT')).toBe('1BoatSLRHtKNngkdXEeobR76b53LETtpyT');
    expect(canonicalAddress('solana', '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK'))
      .toBe('7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK');
  });
});

describe('satoshi test amount: issuance policy (the amount is not selectable)', () => {
  const H = 60 * 60 * 1000;
  const NOW = Date.UTC(2026, 8, 23, 12);
  const draw = (amount: string, hoursAgo: number, o: Partial<OwnDraw> = {}): OwnDraw => ({
    amount, issuedAtMs: NOW - hoursAgo * H, expiresAtMs: NOW - hoursAgo * H + 24 * H, reusable: true, ...o,
  });
  const noneHeld = new Set<string>();

  it('the caps the review asked for: 3 new amounts per address and 10 per account per 24h', () => {
    expect(MAX_NEW_PER_ADDRESS_24H).toBe(3);
    expect(MAX_NEW_PER_TENANT_24H).toBe(10);
    // Another account's hold covers every unexpired amount this one can have on an address.
    expect(OTHER_TENANT_HOLD_MAX).toBeGreaterThanOrEqual(MAX_NEW_PER_ADDRESS_24H);
  });

  it('first tap: a new draw', () => {
    expect(planIssue({ own: [], tenantDraws: [], held: noneHeld, nowMs: NOW }))
      .toEqual({ reuse: null, canDraw: true, retryAtMs: null });
  });

  it('delete + re-add: an unexpired amount comes back instead of a new draw', () => {
    const d = draw('4321', 1);
    const plan = planIssue({ own: [d], tenantDraws: [d.issuedAtMs], held: noneHeld, nowMs: NOW });
    expect(plan.reuse).toBe(d);
  });

  it('reuses the newest unexpired amount, never an expired one', () => {
    const old = draw('1111', 30); // expired 6h ago
    const recent = draw('2222', 2);
    const older = draw('3333', 5);
    expect(planIssue({ own: [old, older, recent], tenantDraws: [], held: noneHeld, nowMs: NOW }).reuse).toBe(recent);
    expect(planIssue({ own: [old], tenantDraws: [], held: noneHeld, nowMs: NOW }))
      .toEqual({ reuse: null, canDraw: true, retryAtMs: null });
  });

  it('skips an amount a pending test holds now (say, the same EVM address on another rail)', () => {
    const a = draw('2222', 1);
    const plan = planIssue({ own: [a], tenantDraws: [a.issuedAtMs], held: new Set(['2222']), nowMs: NOW });
    expect(plan.reuse).toBeNull();
    expect(plan.canDraw).toBe(true);
  });

  it('never reuses a row marked not reusable (a BTC/LTC draw with no baseline)', () => {
    const a = draw('2222', 1, { reusable: false });
    expect(planIssue({ own: [a], tenantDraws: [a.issuedAtMs], held: noneHeld, nowMs: NOW }).reuse).toBeNull();
  });

  it('per address: a 4th new amount within 24h is refused until the oldest ages out', () => {
    const own = [draw('1', 20, { reusable: false }), draw('2', 10, { reusable: false }), draw('3', 2, { reusable: false })];
    const plan = planIssue({ own, tenantDraws: own.map((d) => d.issuedAtMs), held: noneHeld, nowMs: NOW });
    expect(plan).toEqual({ reuse: null, canDraw: false, retryAtMs: NOW - 20 * H + 24 * H });
    // Draws older than 24h don't count.
    const aged = [draw('1', 25, { reusable: false }), draw('2', 10, { reusable: false }), draw('3', 2, { reusable: false })];
    expect(planIssue({ own: aged, tenantDraws: [], held: noneHeld, nowMs: NOW }).canDraw).toBe(true);
  });

  it('per account: the 11th new amount in 24h across addresses is refused', () => {
    const tenantDraws = Array.from({ length: MAX_NEW_PER_TENANT_24H }, (_, i) => NOW - (i + 1) * H);
    const plan = planIssue({ own: [], tenantDraws, held: noneHeld, nowMs: NOW });
    expect(plan.canDraw).toBe(false);
    expect(plan.retryAtMs).toBe(NOW - MAX_NEW_PER_TENANT_24H * H + 24 * H); // the oldest ages out
  });

  it('a reusable amount is still offered when new draws are capped', () => {
    const own = [draw('1', 20, { reusable: false }), draw('2', 10, { reusable: false }), draw('3', 2)];
    const plan = planIssue({ own, tenantDraws: own.map((d) => d.issuedAtMs), held: noneHeld, nowMs: NOW });
    expect(plan.reuse?.amount).toBe('3');
    expect(plan.canDraw).toBe(false);
  });

  it('the reroll loop from the review gets one amount, not 9,000 tries', () => {
    // Loop: draw, delete, re-add, draw... Every pass sees the first draw unexpired and
    // unheld (its challenge row was deleted), so it is handed back every time.
    const first = draw('1234', 0);
    for (let i = 0; i < 100; i++) {
      const plan = planIssue({ own: [first], tenantDraws: [first.issuedAtMs], held: noneHeld, nowMs: NOW + i * 1000 });
      expect(plan.reuse?.amount).toBe('1234');
    }
  });
});

describe('satoshi test amount: one account cannot use up an address\'s pool', () => {
  it('keeps only each other account\'s few most recent amounts', () => {
    const rows: Array<{ tenantId: string; amount: string; issuedAtMs: number }> = [];
    // A griefer drew every amount in the range for the victim's address.
    for (let d = DIGITS_MIN; d <= DIGITS_MAX; d++) rows.push({ tenantId: 'griefer', amount: String(d), issuedAtMs: d });
    rows.push({ tenantId: 'other', amount: '5', issuedAtMs: 1 });
    const kept = recentPerTenant(rows);
    expect(kept).toEqual(new Set(['9999', '9998', '9997', '5']));
    expect(kept.size).toBe(OTHER_TENANT_HOLD_MAX + 1);
    // So the owner still has thousands of amounts to draw from.
    expect(pickTestAmount('bitcoin', kept)).not.toBeNull();
  });
});

describe('satoshi test amount: letter case', () => {
  it('EVM and bech32 are caseless; base58 is not', () => {
    expect(isCaselessAddress('ethereum', '0xAbC0000000000000000000000000000000001234')).toBe(true);
    expect(isCaselessAddress('bitcoin', 'BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ')).toBe(true);
    expect(isCaselessAddress('litecoin', 'ltc1qg9stkxrszkdqsuj4gr3ezcrrwe8h8f8vvnfl8n')).toBe(true);
    expect(isCaselessAddress('bitcoin', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT')).toBe(false);
    expect(isCaselessAddress('solana', '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK')).toBe(false);
  });
});
