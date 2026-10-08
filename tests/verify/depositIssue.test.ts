import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The satoshi test's issue and check paths in verifyRegistry.ts (rule bound_v1), end to end
 * over an in-memory stand-in for the three tables they touch. These pin the review fixes:
 *   - the amount can't be rerolled (delete + re-add hands back the same amount; new draws
 *     are capped), so it can't be steered onto a transaction the owner already made;
 *   - no account can use up an address's 9,000 amounts and lock the owner out;
 *   - BTC/LTC tests carry the issuance baseline, and none is issued without it;
 *   - the 2h post-expiry grace is reachable: a miss in it is 'checking_late', not final;
 *   - claim-once holds across letter case;
 *   - a claim made under the old, unbound rule takes the test again IN PLACE, keeping its hold.
 */

// No database: '@/lib/db' is a small in-memory stand-in that answers exactly the statements
// these paths run, and keeps the rules Postgres enforces for them (one challenge row per
// destination, the global pending-amount unique index, the claim-once index). Any other
// statement throws, so a changed query fails here loudly instead of passing silently.
type Row = Record<string, any>;
const mem = vi.hoisted(() => ({
  dests: [] as Row[],
  challenges: [] as Row[],
  log: [] as Row[],
  seq: 0,
}));

const uniqueViolation = () => Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });

/** The live legacy rule (legacyClaimSql), as the SQL spells it for a table alias. */
const legacySql = (t: string) =>
  `(${t}.legacy_unbound = true OR (${t}.proof_method = 'micro_deposit' AND NOT EXISTS ( SELECT 1 FROM verify_deposit_challenges c WHERE c.destination_id = ${t}.id AND c.tenant_id = ${t}.tenant_id AND c.rule = 'bound_v1' AND c.status = 'proven')))`;
/** The same rule over the in-memory tables. */
const isLegacy = (d: Row) => d.legacy_unbound === true || (d.proof_method === 'micro_deposit'
  && !mem.challenges.some((c) => c.destination_id === d.id && c.tenant_id === d.tenant_id && c.rule === 'bound_v1' && c.status === 'proven'));

function run(sqlIn: string, args: any[] = []): { rows: Row[]; rowsAffected: number } {
  const sql = sqlIn.replace(/\s+/g, ' ').trim();
  const none = { rows: [], rowsAffected: 0 };
  // Schema and the cold-start backfills (ensureVerifyTables).
  if (/^(CREATE|ALTER) /.test(sql) || /^UPDATE verify_destinations d SET legacy_unbound/.test(sql)
    || /^UPDATE verify_destinations SET (domain_anchored_at = proven_at|proof_domain = NULL, last_confirmed_at = NULL) WHERE/.test(sql)) return none;

  // One destination's legacy check (isLegacyClaim).
  if (sql === `SELECT 1 FROM verify_destinations d WHERE d.id = ? AND d.tenant_id = ? AND d.proof_status = 'proven' AND ${legacySql('d')} LIMIT 1`) {
    return { rows: mem.dests.filter((d) => d.id === args[0] && d.tenant_id === args[1] && d.proof_status === 'proven' && isLegacy(d)), rowsAffected: 0 };
  }

  if (/^SELECT id, kind, rail, value, .* FROM verify_destinations WHERE id = \? AND tenant_id = \?$/.test(sql)) {
    const [id, tenant] = args;
    return { rows: mem.dests.filter((d) => d.id === id && d.tenant_id === tenant), rowsAffected: 0 };
  }
  if (sql === 'DELETE FROM verify_destinations WHERE id = ? AND tenant_id = ?') {
    const before = mem.dests.length;
    mem.dests = mem.dests.filter((d) => !(d.id === args[0] && d.tenant_id === args[1]));
    return { rows: [], rowsAffected: before - mem.dests.length };
  }
  if (sql === 'DELETE FROM verify_deposit_challenges WHERE destination_id = ? AND tenant_id = ?') {
    const before = mem.challenges.length;
    mem.challenges = mem.challenges.filter((c) => !(c.destination_id === args[0] && c.tenant_id === args[1]));
    return { rows: [], rowsAffected: before - mem.challenges.length };
  }
  if (/^SELECT status, issued_at, .* FROM verify_deposit_challenges WHERE destination_id = \? AND tenant_id = \? LIMIT 1$/.test(sql)) {
    return { rows: mem.challenges.filter((c) => c.destination_id === args[0] && c.tenant_id === args[1]), rowsAffected: 0 };
  }
  if (sql === 'SELECT expected_amount, issued_at, expires_at, baseline FROM verify_deposit_amount_log WHERE tenant_id = ? AND canonical_address = ? AND issued_at >= ? ORDER BY issued_at DESC') {
    const [tenant, canon, since] = args;
    const rows = mem.log.filter((l) => l.tenant_id === tenant && l.canonical_address === canon && l.issued_at >= since);
    return { rows: rows.sort((a, b) => (a.issued_at < b.issued_at ? 1 : -1)), rowsAffected: 0 };
  }
  if (sql === 'SELECT issued_at FROM verify_deposit_amount_log WHERE tenant_id = ? AND issued_at >= ?') {
    return { rows: mem.log.filter((l) => l.tenant_id === args[0] && l.issued_at >= args[1]), rowsAffected: 0 };
  }
  if (sql === "SELECT expected_amount FROM verify_deposit_challenges WHERE canonical_address = ? AND status = 'pending' AND expected_amount IS NOT NULL") {
    return { rows: mem.challenges.filter((c) => c.canonical_address === args[0] && c.status === 'pending' && c.expected_amount != null), rowsAffected: 0 };
  }
  if (sql === 'SELECT tenant_id, expected_amount, issued_at FROM verify_deposit_amount_log WHERE canonical_address = ? AND issued_at >= ? AND tenant_id <> ?') {
    const [canon, since, tenant] = args;
    return { rows: mem.log.filter((l) => l.canonical_address === canon && l.issued_at >= since && l.tenant_id !== tenant), rowsAffected: 0 };
  }
  if (/^INSERT INTO verify_deposit_challenges /.test(sql)) {
    const [id, destId, tenant, issuedAt, amount, unit, canon, expiresAt, baseline, updatedAt, now] = args;
    const next = {
      id, destination_id: destId, tenant_id: tenant, status: 'pending', issued_at: issuedAt, expected_amount: amount,
      unit, canonical_address: canon, expires_at: expiresAt, rule: 'bound_v1', attempts: 0, last_outcome: null,
      last_checked_at: null, proven_at: null, proof_ref: null, baseline, updated_at: updatedAt,
    };
    // The pending-amount unique index: (canonical_address, expected_amount) WHERE pending.
    if (mem.challenges.some((c) => c.destination_id !== destId && c.status === 'pending'
        && c.canonical_address === canon && c.expected_amount === amount)) throw uniqueViolation();
    const existing = mem.challenges.find((c) => c.destination_id === destId);
    if (!existing) { mem.challenges.push(next); return { rows: [], rowsAffected: 1 }; }
    const replaceable = existing.tenant_id === tenant && (existing.rule !== 'bound_v1' || existing.status !== 'pending'
      || existing.expires_at == null || existing.expires_at < now
      || (sql.includes('OR verify_deposit_challenges.baseline IS NULL') && existing.baseline == null));
    if (!replaceable) return none;
    Object.assign(existing, { ...next, id: existing.id });
    return { rows: [], rowsAffected: 1 };
  }
  if (/^INSERT INTO verify_deposit_amount_log .* WHERE EXISTS/.test(sql)) {
    const [id, tenant, canon, amount, issuedAt, expiresAt, baseline, destId, tenant2, amount2, issuedAt2] = args;
    const written = mem.challenges.some((c) => c.destination_id === destId && c.tenant_id === tenant2
      && c.status === 'pending' && c.expected_amount === amount2 && c.issued_at === issuedAt2);
    if (!written) return none;
    mem.log.push({ id, tenant_id: tenant, canonical_address: canon, expected_amount: amount, issued_at: issuedAt, expires_at: expiresAt, baseline });
    return { rows: [], rowsAffected: 1 };
  }
  if (sql === 'DELETE FROM verify_deposit_amount_log WHERE canonical_address = ? AND issued_at < ?') {
    mem.log = mem.log.filter((l) => !(l.canonical_address === args[0] && l.issued_at < args[1]));
    return none;
  }
  if (/^UPDATE verify_deposit_challenges SET status = \?, attempts = attempts \+ 1/.test(sql)) {
    const [status, outcome, stamp, , destId, tenant] = args;
    const c = mem.challenges.find((x) => x.destination_id === destId && x.tenant_id === tenant && x.status === 'pending');
    if (!c) return none;
    Object.assign(c, { status, attempts: c.attempts + 1, last_outcome: outcome, last_checked_at: stamp });
    return { rows: [], rowsAffected: 1 };
  }
  // The S5a claim guard: other tenants' proven rows of this kind, lowercased containment.
  if (sql === "SELECT value FROM verify_destinations WHERE kind = ? AND proof_status = 'proven' AND tenant_id <> ? AND strpos(lower(value), ?) > 0") {
    const [kind, tenant, needle] = args;
    return {
      rows: mem.dests.filter((d) => d.kind === kind && d.proof_status === 'proven' && d.tenant_id !== tenant
        && String(d.value).toLowerCase().includes(needle)).map((d) => ({ value: d.value })),
      rowsAffected: 0,
    };
  }
  const provenCheck = sql.match(/^SELECT 1 FROM verify_destinations WHERE kind = 'address' AND proof_status = 'proven' AND rail = \? AND tenant_id <> \? AND (lower\(value\)|value) = \? LIMIT 1$/);
  if (provenCheck) {
    const [rail, tenant, v] = args;
    const lower = provenCheck[1] !== 'value';
    return {
      rows: mem.dests.filter((d) => d.kind === 'address' && d.proof_status === 'proven' && d.rail === rail
        && d.tenant_id !== tenant && (lower ? String(d.value).toLowerCase() : d.value) === v),
      rowsAffected: 0,
    };
  }
  if (/^UPDATE verify_destinations SET proof_status = 'proven', proof_method = 'micro_deposit'/.test(sql)) {
    const [stamp, , id, tenant] = args;
    // Unproven, or (the WHERE says so) a proven legacy claim taking the test again in place.
    const inPlace = sql.endsWith(`AND (proof_status <> 'proven' OR ${legacySql('verify_destinations')})`);
    const d = mem.dests.find((x) => x.id === id && x.tenant_id === tenant && (x.proof_status !== 'proven' || (inPlace && isLegacy(x))));
    if (!d) return none;
    // Claim-once index: (rail, value) WHERE proven AND kind = 'address', raw value.
    if (mem.dests.some((x) => x !== d && x.kind === 'address' && x.proof_status === 'proven'
        && x.rail === d.rail && x.value === d.value)) throw uniqueViolation();
    Object.assign(d, {
      proof_status: 'proven', proof_method: 'micro_deposit', proven_at: stamp,
      proof_domain: null, domain_anchored_at: null, last_confirmed_at: null, legacy_unbound: false,
    });
    return { rows: [], rowsAffected: 1 };
  }
  if (/^UPDATE verify_deposit_challenges SET status = 'proven'/.test(sql)) {
    const [stamp, ref, , , destId, tenant] = args;
    const c = mem.challenges.find((x) => x.destination_id === destId && x.tenant_id === tenant);
    if (c) Object.assign(c, { status: 'proven', proven_at: stamp, proof_ref: ref, last_outcome: 'proven' });
    return { rows: [], rowsAffected: c ? 1 : 0 };
  }
  throw new Error(`in-memory db: unexpected statement: ${sql}`);
}

vi.mock('@/lib/db', () => {
  type Stmt = string | { sql: string; args?: any[] };
  const exec = (s: Stmt) => (typeof s === 'string' ? run(s) : run(s.sql, s.args ?? []));
  return {
    db: {
      execute: async (s: Stmt) => exec(s),
      // A transaction: all or nothing.
      batch: async (stmts: Stmt[]) => {
        const saved = JSON.stringify([mem.dests, mem.challenges, mem.log]);
        try {
          return stmts.map(exec);
        } catch (e) {
          [mem.dests, mem.challenges, mem.log] = JSON.parse(saved);
          throw e;
        }
      },
    },
  };
});

// The chain is never read here: detection and the BTC/LTC baseline are stubbed per test.
const chain = vi.hoisted(() => ({ detect: vi.fn(), baseline: vi.fn() }));
vi.mock('../../src/lib/verifyDeposit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/verifyDeposit')>()),
  detectBoundSelfSend: chain.detect,
  captureSelfSendBaseline: chain.baseline,
}));

import {
  issueDepositChallenge,
  getDepositChallenge,
  verifyMicroDeposit,
  deleteDestination,
} from '../../src/lib/verifyRegistry';
import { canonicalAddress, DIGITS_MIN, DIGITS_MAX, OTHER_TENANT_HOLD_MAX } from '../../src/lib/verifyTestAmount';

const H = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const stamp = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const EVM = '0xabcdef0000000000000000000000000000001234';
const BASELINE = { tipHeight: 900_000, mempool: ['already-there'] };

function addDest(tenant: string, rail: string, value: string, o: Row = {}): string {
  const id = `dest-${++mem.seq}`;
  mem.dests.push({
    id, tenant_id: tenant, kind: 'address', rail, value, label: null, display_hint: null,
    proof_method: 'none', proof_status: 'unproven', proof_domain: null, registered_at: stamp(Date.now()),
    proven_at: null, monitor_url: null, monitor_status: null, monitor_checked_at: null, ...o,
  });
  return id;
}
const logDraw = (tenant: string, canon: string, amount: string, issuedMs: number) =>
  mem.log.push({
    id: `log-${++mem.seq}`, tenant_id: tenant, canonical_address: canon, expected_amount: amount,
    issued_at: stamp(issuedMs), expires_at: stamp(issuedMs + 24 * H), baseline: null,
  });
async function issueOk(tenant: string, destId: string) {
  const res = await issueDepositChallenge(tenant, destId);
  if (!res.ok) throw new Error(`issue failed: ${res.error}`);
  return res.challenge;
}

beforeEach(() => {
  mem.dests = []; mem.challenges = []; mem.log = []; mem.seq = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  chain.detect.mockReset();
  chain.baseline.mockReset();
  chain.baseline.mockImplementation(async (rail: string) => (rail === 'bitcoin' || rail === 'litecoin' ? BASELINE : null));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('satoshi test issuance: the amount cannot be rerolled', () => {
  it('delete + re-add within 24h gives back the same amount and window, not a new draw', async () => {
    const d1 = addDest('squatter', 'bitcoin', BTC);
    const first = await issueOk('squatter', d1);
    vi.setSystemTime(T0 + 5 * 60_000);
    await deleteDestination('squatter', d1);
    expect(mem.challenges).toHaveLength(0); // the pending amount is freed...
    const d2 = addDest('squatter', 'bitcoin', BTC);
    const again = await issueOk('squatter', d2);
    expect(again.baseAmount).toBe(first.baseAmount); // ...but not rerolled
    expect(again.expiresAt).toBe(first.expiresAt);
    expect(again.issuedAt).toBe(first.issuedAt);
    expect(mem.log).toHaveLength(1);
    // The original baseline comes back with it (captured once, before the first draw).
    expect(chain.baseline).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mem.challenges[0].baseline)).toEqual(BASELINE);
  });

  it("the review's script (delete, re-add, tap ready, repeat) gets one amount, not a pick of 9,000", async () => {
    let id = addDest('squatter', 'bitcoin', BTC);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add((await issueOk('squatter', id)).baseAmount);
      await deleteDestination('squatter', id);
      id = addDest('squatter', 'bitcoin', BTC.toUpperCase()); // letter case doesn't reset it either
      vi.setSystemTime(T0 + (i + 1) * 1000);
    }
    expect(seen.size).toBe(1);
    expect(mem.log).toHaveLength(1);
  });

  it('once the amount expires, "Get a new amount" draws a different one', async () => {
    const d = addDest('owner', 'bitcoin', BTC);
    const first = await issueOk('owner', d);
    vi.setSystemTime(T0 + 24 * H + 1000);
    const next = await issueOk('owner', d);
    expect(next.baseAmount).not.toBe(first.baseAmount);
    expect(mem.log).toHaveLength(2);
  });

  it('new draws are capped per account; nothing is written or read from the chain past the cap', async () => {
    for (let i = 0; i < 10; i++) logDraw('busy', `other-address-${i}`, String(DIGITS_MIN + i), T0 - (i + 1) * H);
    const d = addDest('busy', 'bitcoin', BTC);
    const res = await issueDepositChallenge('busy', d);
    expect(res).toEqual({ ok: false, error: 'rate_limited', retryAt: new Date(T0 - 10 * H + 24 * H).toISOString().replace('.000', '') });
    expect(mem.challenges).toHaveLength(0);
    expect(chain.baseline).not.toHaveBeenCalled();
  });

  it('new draws are capped per address', async () => {
    const canon = canonicalAddress('bitcoin', BTC);
    // Three draws in the last 24h whose tests are gone (their rows were replaced elsewhere).
    for (const [amount, ago] of [['1111', 20], ['2222', 10], ['3333', 2]] as const) {
      logDraw('busy', canon, amount, T0 - ago * H);
      mem.challenges.push({ destination_id: `elsewhere-${amount}`, tenant_id: 'busy', status: 'pending', canonical_address: canon, expected_amount: amount });
    }
    const res = await issueDepositChallenge('busy', addDest('busy', 'bitcoin', BTC));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe('rate_limited');
  });
});

describe('satoshi test issuance: no account can lock the owner out', () => {
  const canon = canonicalAddress('bitcoin', BTC);

  it('a griefer who logged every amount on the address only holds a few of them', async () => {
    for (let d = DIGITS_MIN; d <= DIGITS_MAX; d++) logDraw('griefer', canon, String(d), T0 - 3 * 24 * H + d * 1000);
    const got = await issueOk('owner', addDest('owner', 'bitcoin', BTC));
    const griefersRecent = [DIGITS_MAX, DIGITS_MAX - 1, DIGITS_MAX - 2].map(String);
    expect(griefersRecent).not.toContain(got.baseAmount);
    expect(OTHER_TENANT_HOLD_MAX).toBe(3);
  });

  it('even thousands of accounts filling the pool with history leave the owner an amount', async () => {
    let n = 0;
    for (let d = DIGITS_MIN; d <= DIGITS_MAX; d += 3) {
      n++;
      for (let k = 0; k < 3 && d + k <= DIGITS_MAX; k++) logDraw(`griefer-${n}`, canon, String(d + k), T0 - H);
    }
    const got = await issueDepositChallenge('owner', addDest('owner', 'bitcoin', BTC));
    expect(got.ok).toBe(true);
  });

  it('with every amount pending elsewhere, the answer is a clear "busy", not a generic error', async () => {
    for (let d = DIGITS_MIN; d <= DIGITS_MAX; d++) {
      mem.challenges.push({ destination_id: `g-${d}`, tenant_id: `g-${d}`, status: 'pending', canonical_address: canon, expected_amount: String(d) });
    }
    expect(await issueDepositChallenge('owner', addDest('owner', 'bitcoin', BTC))).toEqual({ ok: false, error: 'busy' });
  });
});

describe('satoshi test issuance: the BTC/LTC baseline', () => {
  it('is captured before the amount is drawn and stored with the test and the log', async () => {
    const d = addDest('owner', 'bitcoin', BTC);
    await issueOk('owner', d);
    expect(chain.baseline).toHaveBeenCalledWith('bitcoin', BTC);
    expect(JSON.parse(mem.challenges[0].baseline)).toEqual(BASELINE);
    expect(JSON.parse(mem.log[0].baseline)).toEqual(BASELINE);

    chain.detect.mockResolvedValue({ found: false, reason: 'not_yet' });
    vi.setSystemTime(T0 + 60_000);
    expect(await verifyMicroDeposit('owner', d)).toEqual({ outcome: 'not_yet' });
    expect(chain.detect.mock.calls[0][0].baseline).toEqual(BASELINE);
  });

  it('fails closed: no baseline, no amount, nothing written', async () => {
    chain.baseline.mockResolvedValue('unavailable');
    expect(await issueDepositChallenge('owner', addDest('owner', 'litecoin', 'ltc1qg9stkxrszkdqsuj4gr3ezcrrwe8h8f8vvnfl8n')))
      .toEqual({ ok: false, error: 'unavailable' });
    expect(mem.challenges).toHaveLength(0);
    expect(mem.log).toHaveLength(0);
  });

  it('account chains need none', async () => {
    const d = addDest('owner', 'ethereum', EVM);
    await issueOk('owner', d);
    expect(mem.challenges[0].baseline).toBeNull();
    chain.detect.mockResolvedValue({ found: false, reason: 'not_yet' });
    expect(await verifyMicroDeposit('owner', d)).toEqual({ outcome: 'not_yet' });
  });

  it('a BTC test with no baseline can never prove, and the next tap replaces it', async () => {
    const d = addDest('owner', 'bitcoin', BTC);
    mem.challenges.push({
      id: 'old', destination_id: d, tenant_id: 'owner', status: 'pending', issued_at: stamp(T0 - H),
      expires_at: stamp(T0 + 23 * H), expected_amount: '4321', unit: 'BTC', canonical_address: canonicalAddress('bitcoin', BTC),
      rule: 'bound_v1', attempts: 0, last_outcome: null, last_checked_at: null, baseline: null,
    });
    chain.detect.mockResolvedValue({ found: true, ref: 'change-output' });
    expect(await verifyMicroDeposit('owner', d)).toEqual({ outcome: 'no_challenge' });
    expect(chain.detect).not.toHaveBeenCalled();
    expect((await getDepositChallenge('owner', d))).toEqual({ ok: true, challenge: null });
    const fresh = await issueOk('owner', d);
    expect(fresh.baseAmount).not.toBe('4321');
    expect(JSON.parse(mem.challenges[0].baseline)).toEqual(BASELINE);
  });
});

describe('satoshi test check: the 2h grace after expiry is reachable', () => {
  async function issued() {
    const d = addDest('owner', 'bitcoin', BTC);
    const ch = await issueOk('owner', d);
    return { d, ch };
  }

  it('a miss inside the grace is checking_late (not final), and the test stays open', async () => {
    const { d, ch } = await issued();
    chain.detect.mockResolvedValue({ found: false, reason: 'not_yet' });
    vi.setSystemTime(T0 + 24 * H + 20_000);
    expect(await verifyMicroDeposit('owner', d)).toEqual({ outcome: 'checking_late' });
    expect(mem.challenges[0].status).toBe('pending');
    const view = await getDepositChallenge('owner', d);
    expect(view.ok && view.challenge).toMatchObject({ late: true, expired: false });
    expect(view.ok && view.challenge?.checkUntil).toBe(new Date(Date.parse(ch.expiresAt) + 2 * H).toISOString().replace('.000', ''));
    // A diagnostic can't be acted on after expiry either, so it reads as checking_late too.
    chain.detect.mockResolvedValue({ found: false, reason: 'wrong_amount' });
    vi.setSystemTime(T0 + 24 * H + 60_000);
    expect(await verifyMicroDeposit('owner', d)).toEqual({ outcome: 'checking_late' });
  });

  it('a send made in time and found inside the grace proves the address', async () => {
    const { d } = await issued();
    chain.detect.mockResolvedValue({ found: false, reason: 'not_yet' });
    vi.setSystemTime(T0 + 24 * H + 20_000);
    await verifyMicroDeposit('owner', d);
    chain.detect.mockResolvedValue({ found: true, ref: 'late-indexed' });
    vi.setSystemTime(T0 + 24 * H + 40_000);
    expect(await verifyMicroDeposit('owner', d)).toEqual({ outcome: 'proven', ref: 'late-indexed' });
    expect(mem.dests[0].proof_status).toBe('proven');
  });

  it('an unreachable chain inside the grace stays unavailable', async () => {
    const { d } = await issued();
    chain.detect.mockResolvedValue({ found: false, reason: 'unavailable' });
    vi.setSystemTime(T0 + 25 * H);
    expect(await verifyMicroDeposit('owner', d)).toEqual({ outcome: 'unavailable' });
  });

  it('after the grace it is expired, for good', async () => {
    const { d } = await issued();
    chain.detect.mockResolvedValue({ found: true, ref: 'too-late' });
    vi.setSystemTime(T0 + 26 * H + 1000);
    expect(await verifyMicroDeposit('owner', d)).toEqual({ outcome: 'expired' });
    expect(chain.detect).not.toHaveBeenCalled();
    expect(mem.challenges[0].status).toBe('expired');
    const view = await getDepositChallenge('owner', d);
    expect(view.ok && view.challenge).toMatchObject({ late: false, expired: true });
  });

  it('before expiry the view is neither late nor expired', async () => {
    const { d } = await issued();
    const view = await getDepositChallenge('owner', d);
    expect(view.ok && view.challenge).toMatchObject({ late: false, expired: false });
  });
});

describe('satoshi test check: claim-once across letter case', () => {
  it("a squatter's uppercase bech32 can't be claimed once the owner has proven the lowercase form", async () => {
    addDest('owner', 'bitcoin', BTC, { proof_status: 'proven', proof_method: 'micro_deposit' });
    const d = addDest('squatter', 'bitcoin', BTC.toUpperCase());
    await issueOk('squatter', d);
    chain.detect.mockResolvedValue({ found: true, ref: 'x' });
    vi.setSystemTime(T0 + 60_000);
    expect(await verifyMicroDeposit('squatter', d)).toEqual({ outcome: 'claimed_elsewhere' });
    expect(mem.dests.find((x) => x.id === d)?.proof_status).toBe('unproven');
  });

  it('an EVM address in other letter case is the same address', async () => {
    addDest('owner', 'ethereum', EVM, { proof_status: 'proven', proof_method: 'micro_deposit' });
    const d = addDest('squatter', 'ethereum', EVM.replace('abcdef', 'ABCDEF'));
    await issueOk('squatter', d);
    chain.detect.mockResolvedValue({ found: true, ref: 'x' });
    vi.setSystemTime(T0 + 60_000);
    expect(await verifyMicroDeposit('squatter', d)).toEqual({ outcome: 'claimed_elsewhere' });
  });

  it('the same tenant proving its own address is never blocked', async () => {
    const d = addDest('owner', 'bitcoin', BTC);
    await issueOk('owner', d);
    chain.detect.mockResolvedValue({ found: true, ref: 'x' });
    vi.setSystemTime(T0 + 60_000);
    expect(await verifyMicroDeposit('owner', d)).toEqual({ outcome: 'proven', ref: 'x' });
  });
});

describe('a claim made under the old, unbound rule takes the test again in place', () => {
  /** A wallet proven under the old rule: tagged, with its old (unbound) challenge row. */
  function legacyDest(tenant: string, rail: string, value: string, o: Row = {}): string {
    const id = addDest(tenant, rail, value, {
      proof_status: 'proven', proof_method: 'micro_deposit', proven_at: stamp(T0 - 90 * 24 * H), legacy_unbound: true, ...o,
    });
    mem.challenges.push({
      id: `old-${id}`, destination_id: id, tenant_id: tenant, status: 'proven', issued_at: stamp(T0 - 91 * 24 * H),
      expires_at: null, expected_amount: null, unit: null, canonical_address: canonicalAddress(rail, value),
      rule: null, attempts: 1, last_outcome: 'proven', last_checked_at: null, baseline: null,
    });
    return id;
  }
  const dest = (id: string) => mem.dests.find((d) => d.id === id)!;

  it('issues a bound test on the same row; the row keeps its claim-once hold while it is pending', async () => {
    const d = legacyDest('owner', 'bitcoin', BTC);
    expect((await getDepositChallenge('owner', d))).toEqual({ ok: true, challenge: null }); // the old test is not bound
    const ch = await issueOk('owner', d);
    expect(mem.challenges).toHaveLength(1); // the old, unbound row was replaced
    expect(mem.challenges[0]).toMatchObject({ rule: 'bound_v1', status: 'pending', expected_amount: ch.baseAmount });
    expect(dest(d)).toMatchObject({ proof_status: 'proven', legacy_unbound: true });
    expect((await getDepositChallenge('owner', d)).ok && (await getDepositChallenge('owner', d) as any).challenge?.baseAmount).toBe(ch.baseAmount);

    // Meanwhile nobody else can take the wallet: it is still proven by this account.
    const squat = addDest('squatter', 'bitcoin', BTC);
    await issueOk('squatter', squat);
    chain.detect.mockResolvedValue({ found: true, ref: 'x' });
    vi.setSystemTime(T0 + 60_000);
    expect(await verifyMicroDeposit('squatter', squat)).toEqual({ outcome: 'claimed_elsewhere' });
  });

  it('a found test re-proves it: new proven_at, tag cleared, and it is no longer offered the test', async () => {
    const d = legacyDest('owner', 'ethereum', EVM);
    await issueOk('owner', d);
    chain.detect.mockResolvedValue({ found: true, ref: '0xbound' });
    vi.setSystemTime(T0 + 60_000);
    expect(await verifyMicroDeposit('owner', d)).toEqual({ outcome: 'proven', ref: '0xbound' });
    expect(dest(d)).toMatchObject({ proof_status: 'proven', proof_method: 'micro_deposit', legacy_unbound: false, proven_at: stamp(T0 + 60_000) });
    expect(mem.challenges[0]).toMatchObject({ rule: 'bound_v1', status: 'proven' });
    expect(await issueDepositChallenge('owner', d)).toEqual({ ok: false, error: 'already_proven' });
    expect(await verifyMicroDeposit('owner', d)).toEqual({ outcome: 'already_proven' });
  });

  it('a miss changes nothing: the row stays a proven legacy claim', async () => {
    const d = legacyDest('owner', 'ethereum', EVM);
    await issueOk('owner', d);
    chain.detect.mockResolvedValue({ found: false, reason: 'not_yet' });
    vi.setSystemTime(T0 + 60_000);
    expect(await verifyMicroDeposit('owner', d)).toEqual({ outcome: 'not_yet' });
    expect(dest(d)).toMatchObject({ proof_status: 'proven', legacy_unbound: true });
  });

  it('an untagged claim the backfill never reached counts too (no bound test ever proved it)', async () => {
    const d = legacyDest('owner', 'ethereum', EVM, { legacy_unbound: false });
    expect((await issueDepositChallenge('owner', d)).ok).toBe(true);
    // ...and a PENDING bound test does not make it bound: only a proved one does.
    chain.detect.mockResolvedValue({ found: false, reason: 'not_yet' });
    vi.setSystemTime(T0 + 60_000);
    expect(await verifyMicroDeposit('owner', d)).toEqual({ outcome: 'not_yet' });
    chain.detect.mockResolvedValue({ found: true, ref: '0xbound' });
    vi.setSystemTime(T0 + 120_000);
    expect(await verifyMicroDeposit('owner', d)).toEqual({ outcome: 'proven', ref: '0xbound' });
  });

  it('a bound claim is never offered the test again', async () => {
    const d = addDest('owner', 'ethereum', EVM);
    await issueOk('owner', d);
    chain.detect.mockResolvedValue({ found: true, ref: '0xbound' });
    vi.setSystemTime(T0 + 60_000);
    expect(await verifyMicroDeposit('owner', d)).toEqual({ outcome: 'proven', ref: '0xbound' });
    expect(await issueDepositChallenge('owner', d)).toEqual({ ok: false, error: 'already_proven' });
    expect(await getDepositChallenge('owner', d)).toEqual({ ok: true, challenge: null });
  });
});
