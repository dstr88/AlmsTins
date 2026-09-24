import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A tiny in-memory stand-in for verify_destinations, enough to drive the claim guard and
// the two flip paths with no database. It answers only the statements those paths issue
// and throws on anything else, so a new query shows up as a failing test, not a silent
// pass. Every statement is recorded so tests can assert the guard actually ran.
type Row = {
  id: string; tenant_id: string; kind: 'address' | 'qr'; rail: string; value: string;
  label: string | null; proof_status: string; proof_method: string; proof_domain: string | null;
};
const GUARD_SQL = vi.hoisted(() => "SELECT value FROM verify_destinations WHERE kind = ? AND proof_status = 'proven' AND tenant_id <> ?");
const store = vi.hoisted(() => ({
  rows: [] as Row[],
  calls: [] as { sql: string; args: unknown[] }[],
  /** The guard read returns nothing (a concurrent proof it could not see yet). */
  guardBlind: false,
  /** The guard read fails (DB error). */
  guardThrows: false,
}));

vi.mock('@/lib/db', () => {
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
  const out = (r: Row) => ({
    ...r, display_hint: null, registered_at: '2026-09-01 00:00:00', proven_at: null,
    monitor_url: null, monitor_status: null, monitor_checked_at: null,
  });
  const execute = async (stmt: { sql: string; args?: unknown[] }) => {
    const sql = flat(stmt.sql);
    const args = stmt.args ?? [];
    store.calls.push({ sql, args });
    if (/^(CREATE|ALTER) /.test(sql)) return { rows: [] };
    if (sql.startsWith('UPDATE verify_domain_proofs') || sql.startsWith('UPDATE verify_deposit_challenges')) {
      return { rows: [] };
    }
    if (sql.startsWith('SELECT issued_at FROM verify_deposit_challenges')) {
      return { rows: [{ issued_at: '2026-09-01 00:00:00' }] };
    }
    // The S5a guard: other tenants' proven rows of this kind, lowercased containment. It
    // reads the value only, never the rail.
    if (sql.startsWith(GUARD_SQL)) {
      const [kind, tenantId, needle] = args as string[];
      if (store.guardThrows) throw new Error('connection reset');
      if (store.guardBlind) return { rows: [] };
      return {
        rows: store.rows
          .filter((r) => r.kind === kind && r.proof_status === 'proven' && r.tenant_id !== tenantId
            && r.value.toLowerCase().includes(needle))
          .map((r) => ({ value: r.value })),
      };
    }
    if (sql.startsWith('SELECT COUNT(*) AS cnt FROM verify_destinations WHERE tenant_id = ? AND kind = ?')) {
      return { rows: [{ cnt: store.rows.filter((r) => r.tenant_id === args[0] && r.kind === args[1]).length }] };
    }
    if (sql.startsWith('SELECT 1 FROM verify_destinations WHERE tenant_id = ? AND kind = ? AND value = ?')) {
      return { rows: store.rows.filter((r) => r.tenant_id === args[0] && r.kind === args[1] && r.value === args[2]) };
    }
    if (sql.startsWith('INSERT INTO verify_destinations')) {
      const [id, tenant_id, kind, rail, value, label, , proof_method, proof_status] = args as any[];
      store.rows.push({ id, tenant_id, kind, rail, value, label, proof_method, proof_status, proof_domain: null });
      return { rows: [] };
    }
    if (/FROM verify_destinations WHERE tenant_id = \? ORDER BY/.test(sql)) {
      return { rows: store.rows.filter((r) => r.tenant_id === args[0]).map(out) };
    }
    if (/FROM verify_destinations WHERE id = \? AND tenant_id = \?$/.test(sql)) {
      return { rows: store.rows.filter((r) => r.id === args[0] && r.tenant_id === args[1]).map(out) };
    }
    if (sql.startsWith("UPDATE verify_destinations SET proof_status = 'proven'")) {
      const [id, tenantId] = args.slice(-2) as string[];
      const row = store.rows.find((r) => r.id === id && r.tenant_id === tenantId);
      if (!row) return { rows: [] };
      // The real partial unique index on the RAW (rail, value) of proven address rows.
      if (store.rows.some((r) => r !== row && r.kind === 'address' && r.proof_status === 'proven'
        && r.rail === row.rail && r.value === row.value)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      }
      row.proof_status = 'proven';
      row.proof_method = sql.includes("'well_known'") ? 'well_known' : 'micro_deposit';
      if (sql.includes("'well_known'")) row.proof_domain = String(args[0]);
      return { rows: [] };
    }
    throw new Error(`fake db: unexpected SQL: ${sql}`);
  };
  return { db: { execute, batch: async () => { throw new Error('fake db: batch not supported'); } } };
});

// The self-send path reads the chain; stub it to "a qualifying outgoing tx was found".
vi.mock('../../src/lib/verifyDeposit', () => ({
  detectOutgoingSince: vi.fn(async () => ({ found: true, ref: '0xtxref' })),
}));

import {
  claimFamily, claimIdentity, sameClaimIdentity, canAnchor, isClaimedElsewhere,
  recordProofResult, verifyMicroDeposit, createDestination,
} from '../../src/lib/verifyRegistry';

const CHECKSUM = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const LOWER = CHECKSUM.toLowerCase();
const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const SOL = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
/** Every rail a bitcoin value can be re-filed under in createDestination (plus a legacy
 *  off-list spelling), other than its own. */
const OTHER_RAILS_FOR_BTC = ['litecoin', 'solana', 'ethereum', 'polygon', 'avalanche', 'btc'];

function row(p: Partial<Row> & Pick<Row, 'id' | 'tenant_id' | 'rail' | 'value'>): Row {
  return { kind: 'address', label: null, proof_status: 'unproven', proof_method: 'none', proof_domain: null, ...p };
}
const guardCalls = () => store.calls.filter((c) => c.sql.startsWith(GUARD_SQL));
const flipCalls = () => store.calls.filter((c) => c.sql.startsWith("UPDATE verify_destinations SET proof_status = 'proven'"));

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  store.rows = [];
  store.calls = [];
  store.guardBlind = false;
  store.guardThrows = false;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); // the held-out paths log
});
afterEach(() => { warn.mockRestore(); });

describe('claim identity (pure)', () => {
  it('takes the family from the value, never the rail: a 0x value is evm', () => {
    expect(claimFamily('address', LOWER)).toBe('evm');
    expect(claimIdentity('address', CHECKSUM)).toEqual({ canonical: LOWER, family: 'evm' });
  });

  it('puts every non-0x address in one shared family', () => {
    expect(claimFamily('address', BTC)).toBe('addr');
    expect(claimFamily('address', SOL)).toBe('addr');
    expect(claimFamily('address', 'ltc1qg82tkln7qz9uq4zms9p6kwhnxsdjqm5vdzrrgy')).toBe('addr');
    expect(claimIdentity('address', BTC)).toEqual({ canonical: BTC, family: 'addr' });
  });

  it('puts every payment-link/QR in one family (the scan lookup ignores the rail)', () => {
    expect(claimFamily('qr', 'https://pix.example.com/loc/1')).toBe('qr');
    expect(claimIdentity('qr', 'https://pix.example.com/loc/1').family).toBe('qr');
    // A link and an address with the same text are different kinds, never one identity.
    expect(sameClaimIdentity(claimIdentity('qr', BTC), claimIdentity('address', BTC))).toBe(false);
  });

  it('canonicalizes an EVM address to lowercase, including inside a URI', () => {
    expect(claimIdentity('address', CHECKSUM).canonical).toBe(LOWER);
    expect(claimIdentity('address', `ethereum:${CHECKSUM}@1`).canonical).toBe(LOWER);
  });

  it('matches a lowercase EVM twin', () => {
    const mine = claimIdentity('address', CHECKSUM);
    expect(sameClaimIdentity(mine, claimIdentity('address', LOWER))).toBe(true);
    expect(sameClaimIdentity(mine, claimIdentity('address', `polygon:${LOWER}`))).toBe(true);
    expect(canAnchor(mine, [claimIdentity('address', LOWER)])).toBe(false);
  });

  it('non-0x addresses are exact-match: case matters', () => {
    const sol = claimIdentity('address', SOL);
    expect(sameClaimIdentity(sol, claimIdentity('address', SOL))).toBe(true);
    expect(sameClaimIdentity(sol, claimIdentity('address', SOL.toLowerCase()))).toBe(false);
    expect(sameClaimIdentity(claimIdentity('address', BTC), claimIdentity('address', SOL))).toBe(false);
    // A payment URI around the same address is still the same address.
    expect(sameClaimIdentity(
      claimIdentity('address', BTC),
      claimIdentity('address', `bitcoin:${BTC}?amount=0.1`),
    )).toBe(true);
  });

  it('an empty canonical value never matches anything', () => {
    const empty = claimIdentity('address', '   ');
    expect(empty.canonical).toBe('');
    expect(sameClaimIdentity(empty, empty)).toBe(false);
    expect(canAnchor(empty, [empty])).toBe(true);
  });

  it('allows an anchor when no other account holds the identity', () => {
    const mine = claimIdentity('address', CHECKSUM);
    expect(canAnchor(mine, [])).toBe(true);
    expect(canAnchor(mine, [claimIdentity('address', '0x' + '1'.repeat(40))])).toBe(true);
  });
});

describe('isClaimedElsewhere (the S5a guard)', () => {
  it('blocks a lowercase twin of an EVM address another account proved', async () => {
    store.rows = [row({ id: 'a1', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven' })];
    expect(await isClaimedElsewhere('attacker', 'address', LOWER)).toBe(true);
  });

  it('blocks a wallet another account proved under any rail, EVM or not', async () => {
    for (const rail of ['polygon', 'avalanche', 'bitcoin']) {
      store.rows = [row({ id: 'a1', tenant_id: 'merchant', rail, value: CHECKSUM, proof_status: 'proven' })];
      expect(await isClaimedElsewhere('attacker', 'address', LOWER)).toBe(true);
    }
    for (const rail of ['bitcoin', ...OTHER_RAILS_FOR_BTC]) {
      store.rows = [row({ id: 'b1', tenant_id: 'merchant', rail, value: BTC, proof_status: 'proven' })];
      expect(await isClaimedElsewhere('attacker', 'address', BTC)).toBe(true);
    }
  });

  it('allows the same account to re-prove, or prove under a second rail', async () => {
    store.rows = [row({ id: 'a1', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven' })];
    expect(await isClaimedElsewhere('merchant', 'address', CHECKSUM)).toBe(false);
    expect(await isClaimedElsewhere('merchant', 'address', LOWER)).toBe(false);
    // The query itself excludes the caller's tenant; only the value comes back, and the
    // rail is neither selected nor filtered on.
    const [call] = guardCalls();
    expect(call.sql).toContain('tenant_id <> ?');
    expect(call.sql.split(' FROM ')[0]).toBe('SELECT value');
    expect(call.sql).not.toMatch(/\brail\b/);
    expect(call.args[1]).toBe('merchant');
  });

  it('ignores rows that are not proven', async () => {
    store.rows = [row({ id: 'a1', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'lapsed' })];
    expect(await isClaimedElsewhere('attacker', 'address', LOWER)).toBe(false);
  });

  it('non-0x addresses are exact-match', async () => {
    store.rows = [row({ id: 's1', tenant_id: 'merchant', rail: 'solana', value: SOL, proof_status: 'proven' })];
    expect(await isClaimedElsewhere('other', 'address', SOL)).toBe(true);
    // Different case is a different base58 address, even though the SQL prefilter is
    // case-insensitive: the canonical compare in code decides.
    expect(await isClaimedElsewhere('other', 'address', SOL.toLowerCase())).toBe(false);
  });

  it('sees a proven twin stored inside a payment URI', async () => {
    store.rows = [row({ id: 'b1', tenant_id: 'merchant', rail: 'bitcoin', value: `bitcoin:${BTC}?amount=1`, proof_status: 'proven' })];
    expect(await isClaimedElsewhere('other', 'address', BTC)).toBe(true);
  });
});

describe('the .well-known file flip runs the guard', () => {
  it('holds out a lowercase EVM twin and reports it as claimed elsewhere', async () => {
    store.rows = [
      row({ id: 'real', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven', proof_method: 'micro_deposit' }),
      row({ id: 'twin', tenant_id: 'attacker', rail: 'ethereum', value: LOWER }),
    ];
    const res = await recordProofResult('attacker', 'attacker.example', [LOWER]);
    expect(res).toEqual({ flipped: [], claimedElsewhere: ['twin'] });
    expect(guardCalls()).toHaveLength(1);
    expect(guardCalls()[0].args).toEqual(['address', 'attacker', LOWER]);
    expect(flipCalls()).toHaveLength(0);
    expect(store.rows.find((r) => r.id === 'twin')!.proof_status).toBe('unproven');
  });

  it('holds out the same address filed under another EVM rail', async () => {
    store.rows = [
      row({ id: 'real', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven' }),
      row({ id: 'poly', tenant_id: 'attacker', rail: 'polygon', value: CHECKSUM }),
    ];
    const res = await recordProofResult('attacker', 'attacker.example', [CHECKSUM]);
    expect(res).toEqual({ flipped: [], claimedElsewhere: ['poly'] });
    expect(flipCalls()).toHaveLength(0);
  });

  it('holds out a bitcoin wallet re-filed under any other rail (S5 cross-rail twin)', async () => {
    // createDestination checks the rail is on the list, never that the value fits it, and
    // the public lookup ignores the rail, so the twin would read as a second owner.
    for (const rail of OTHER_RAILS_FOR_BTC) {
      store.rows = [
        row({ id: 'real', tenant_id: 'merchant', rail: 'bitcoin', value: BTC, proof_status: 'proven', proof_method: 'micro_deposit' }),
        row({ id: 'twin', tenant_id: 'attacker', rail, value: BTC }),
      ];
      store.calls = [];
      const res = await recordProofResult('attacker', 'attacker.example', [BTC]);
      expect(res, rail).toEqual({ flipped: [], claimedElsewhere: ['twin'] });
      expect(flipCalls(), rail).toHaveLength(0);
      expect(store.rows.find((r) => r.id === 'twin')!.proof_status, rail).toBe('unproven');
    }
  });

  it('holds out a Solana wallet re-filed under bitcoin, and a legacy off-list rail twin', async () => {
    store.rows = [
      row({ id: 'real', tenant_id: 'merchant', rail: 'solana', value: SOL, proof_status: 'proven' }),
      row({ id: 'twin', tenant_id: 'attacker', rail: 'bitcoin', value: SOL }),
    ];
    expect(await recordProofResult('attacker', 'attacker.example', [SOL]))
      .toEqual({ flipped: [], claimedElsewhere: ['twin'] });

    // A pre-allowlist row on a spelling like 'btc' still anchors the wallet.
    store.rows = [
      row({ id: 'legacy', tenant_id: 'merchant', rail: 'btc', value: BTC, proof_status: 'proven' }),
      row({ id: 'twin', tenant_id: 'attacker', rail: 'bitcoin', value: BTC }),
    ];
    expect(await recordProofResult('attacker', 'attacker.example', [BTC]))
      .toEqual({ flipped: [], claimedElsewhere: ['twin'] });
  });

  it('the raw (rail, value) index alone would let a cross-rail twin through: the guard is what stops it', async () => {
    store.rows = [
      row({ id: 'real', tenant_id: 'merchant', rail: 'bitcoin', value: BTC, proof_status: 'proven' }),
      row({ id: 'twin', tenant_id: 'attacker', rail: 'litecoin', value: BTC }),
    ];
    store.guardBlind = true; // what the flip does with no S5a guard
    const res = await recordProofResult('attacker', 'attacker.example', [BTC]);
    expect(res.flipped).toEqual(['twin']);
  });

  it('still flips an unclaimed wallet, and a wallet the same account already proved elsewhere', async () => {
    store.rows = [
      row({ id: 'eth', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven', proof_method: 'micro_deposit' }),
      row({ id: 'poly', tenant_id: 'merchant', rail: 'polygon', value: LOWER }),
      row({ id: 'btc', tenant_id: 'merchant', rail: 'bitcoin', value: BTC }),
    ];
    const res = await recordProofResult('merchant', 'merchant.example', [CHECKSUM, BTC]);
    expect(res.claimedElsewhere).toEqual([]);
    expect(res.flipped.sort()).toEqual(['btc', 'eth', 'poly']);
    // Guard ran once per row that needed a flip (not for the already-proven one).
    expect(guardCalls()).toHaveLength(2);
    expect(store.rows.find((r) => r.id === 'poly')!.proof_status).toBe('proven');
    expect(store.rows.find((r) => r.id === 'btc')!.proof_domain).toBe('merchant.example');
  });

  it('maps an exact-duplicate unique violation (a race past the guard) to claimed elsewhere', async () => {
    // The race: another account's proof lands after the guard read, so the guard sees
    // nothing and the claim-once index rejects the write instead.
    store.rows = [
      row({ id: 'real', tenant_id: 'merchant', rail: 'bitcoin', value: BTC, proof_status: 'proven' }),
      row({ id: 'dup', tenant_id: 'other', rail: 'bitcoin', value: BTC }),
    ];
    store.guardBlind = true;
    const res = await recordProofResult('other', 'other.example', [BTC]);
    expect(res).toEqual({ flipped: [], claimedElsewhere: ['dup'] });
    expect(flipCalls()).toHaveLength(1);
    expect(store.rows.find((r) => r.id === 'dup')!.proof_status).toBe('unproven');
  });

  it('fails closed when the guard cannot read: nothing flips and nothing is blamed on another account', async () => {
    store.rows = [row({ id: 'btc', tenant_id: 'merchant', rail: 'bitcoin', value: BTC })];
    store.guardThrows = true;
    const res = await recordProofResult('merchant', 'merchant.example', [BTC]);
    expect(res).toEqual({ flipped: [], claimedElsewhere: [] });
    expect(flipCalls()).toHaveLength(0);
  });
});

describe('the self-send flip runs the guard', () => {
  it('reports claimed_elsewhere for a lowercase EVM twin and does not flip', async () => {
    store.rows = [
      row({ id: 'real', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven', proof_method: 'well_known' }),
      row({ id: 'twin', tenant_id: 'second', rail: 'ethereum', value: LOWER }),
    ];
    const res = await verifyMicroDeposit('second', 'twin');
    expect(res).toEqual({ outcome: 'claimed_elsewhere' });
    expect(guardCalls()).toHaveLength(1);
    expect(guardCalls()[0].args).toEqual(['address', 'second', LOWER]);
    expect(flipCalls()).toHaveLength(0);
  });

  it('reports claimed_elsewhere for the same address on another EVM rail', async () => {
    store.rows = [
      row({ id: 'real', tenant_id: 'merchant', rail: 'avalanche', value: CHECKSUM, proof_status: 'proven' }),
      row({ id: 'eth', tenant_id: 'second', rail: 'ethereum', value: CHECKSUM }),
    ];
    expect(await verifyMicroDeposit('second', 'eth')).toEqual({ outcome: 'claimed_elsewhere' });
    expect(flipCalls()).toHaveLength(0);
  });

  it('reports claimed_elsewhere for a bitcoin wallet re-filed under any other rail', async () => {
    for (const rail of OTHER_RAILS_FOR_BTC) {
      store.rows = [
        row({ id: 'real', tenant_id: 'merchant', rail: 'bitcoin', value: BTC, proof_status: 'proven', proof_method: 'well_known' }),
        row({ id: 'twin', tenant_id: 'second', rail, value: BTC }),
      ];
      store.calls = [];
      expect(await verifyMicroDeposit('second', 'twin'), rail).toEqual({ outcome: 'claimed_elsewhere' });
      expect(guardCalls()[0].args, rail).toEqual(['address', 'second', BTC.toLowerCase()]);
      expect(flipCalls(), rail).toHaveLength(0);
      expect(store.rows.find((r) => r.id === 'twin')!.proof_status, rail).toBe('unproven');
    }
  });

  it('reports claimed_elsewhere for a Solana wallet re-filed under bitcoin', async () => {
    store.rows = [
      row({ id: 'real', tenant_id: 'merchant', rail: 'solana', value: SOL, proof_status: 'proven' }),
      row({ id: 'twin', tenant_id: 'second', rail: 'bitcoin', value: SOL }),
    ];
    expect(await verifyMicroDeposit('second', 'twin')).toEqual({ outcome: 'claimed_elsewhere' });
    expect(flipCalls()).toHaveLength(0);
  });

  it('flips when the only proven twin belongs to the same account', async () => {
    store.rows = [
      row({ id: 'eth', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven' }),
      row({ id: 'poly', tenant_id: 'merchant', rail: 'polygon', value: LOWER }),
    ];
    expect(await verifyMicroDeposit('merchant', 'poly')).toEqual({ outcome: 'proven', ref: '0xtxref' });
    expect(guardCalls()).toHaveLength(1);
    expect(flipCalls()).toHaveLength(1);
    expect(store.rows.find((r) => r.id === 'poly')!.proof_status).toBe('proven');
  });

  it('non-0x self-send is exact-match: a different-case Solana string is not blocked', async () => {
    store.rows = [
      row({ id: 's1', tenant_id: 'merchant', rail: 'solana', value: SOL, proof_status: 'proven' }),
      row({ id: 's2', tenant_id: 'other', rail: 'solana', value: SOL.toLowerCase() }),
    ];
    expect(await verifyMicroDeposit('other', 's2')).toEqual({ outcome: 'proven', ref: '0xtxref' });
  });

  it('fails closed when the guard cannot read: throws, nothing flips', async () => {
    store.rows = [row({ id: 'eth', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM })];
    store.guardThrows = true;
    await expect(verifyMicroDeposit('merchant', 'eth')).rejects.toThrow();
    expect(flipCalls()).toHaveLength(0);
    expect(store.rows[0].proof_status).toBe('unproven');
  });
});

describe('registration', () => {
  it('a payment link another account proved on another QR rail is claimed elsewhere', async () => {
    // A dynamic PIX QR stores its PSP location URL; the same URL registered as a plain
    // link must not become a second verified owner (the scan lookup ignores the rail).
    store.rows = [row({
      id: 'q1', tenant_id: 'merchant', kind: 'qr', rail: 'pix', value: 'https://pix.example.com/loc/abc',
      proof_status: 'proven', proof_method: 'account_claim',
    })];
    const res = await createDestination('other', { kind: 'qr', rail: 'url', value: 'https://PIX.example.com/loc/abc/' });
    expect(res).toMatchObject({ ok: false, error: 'claimed_elsewhere' });
    expect(guardCalls()[0].args).toEqual(['qr', 'other', 'https://pix.example.com/loc/abc']);
    expect(store.rows).toHaveLength(1);
  });

  it('a payment link nobody else proved is claimed on save', async () => {
    const res = await createDestination('merchant', { kind: 'qr', rail: 'url', value: 'https://buy.stripe.com/abc123' });
    expect(res.ok).toBe(true);
    expect(store.rows[0]).toMatchObject({ kind: 'qr', rail: 'url', proof_status: 'proven', proof_method: 'account_claim' });
  });

  it('rejects an address on an unsupported rail', async () => {
    for (const rail of ['btc', 'base', 'tron']) {
      const res = await createDestination('attacker', { kind: 'address', rail, value: BTC });
      expect(res).toMatchObject({ ok: false, error: 'invalid' });
    }
    expect(store.rows).toHaveLength(0);
  });

  it('accepts a supported rail in any case and stores it lowercased, unproven', async () => {
    const res = await createDestination('merchant', { kind: 'address', rail: 'Bitcoin', value: BTC });
    expect(res.ok).toBe(true);
    expect(store.rows[0]).toMatchObject({ rail: 'bitcoin', value: BTC, proof_status: 'unproven' });
    expect(guardCalls()).toHaveLength(0); // registering an address is not a claim
  });
});
