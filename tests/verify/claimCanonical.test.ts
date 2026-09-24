import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// A tiny in-memory stand-in for verify_destinations, enough to drive the claim guard, the
// two flip paths, the domain anchor path and the public lookup with no database. It answers only the
// statements those paths issue and throws on anything else, so a new query shows up as a
// failing test, not a silent pass. Every statement is recorded so tests can assert the
// guard actually ran.
type Row = {
  id: string; tenant_id: string; kind: 'address' | 'qr'; rail: string; value: string;
  label: string | null; proof_status: string; proof_method: string; proof_domain: string | null;
  proven_at: string | null; domain_anchored_at: string | null; last_confirmed_at: string | null;
  legacy_unbound: boolean;
  /** Stands in for "a bound_v1 satoshi test for this row proved" (verify_deposit_challenges).
   *  With legacy_unbound it decides the live legacy rule (legacyClaimSql). */
  bound_test_proven: boolean;
};
const GUARD_SQL = vi.hoisted(() => "SELECT value FROM verify_destinations WHERE kind = ? AND proof_status = 'proven' AND tenant_id <> ?");
/** The live legacy rule, as the SQL spells it for a table alias (legacyClaimSql). */
const LEGACY_SQL = vi.hoisted(() => (t: string) =>
  `(${t}.legacy_unbound = true OR (${t}.proof_method = 'micro_deposit' AND NOT EXISTS ( SELECT 1 FROM verify_deposit_challenges c WHERE c.destination_id = ${t}.id AND c.tenant_id = ${t}.tenant_id AND c.rule = 'bound_v1' AND c.status = 'proven')))`);
const store = vi.hoisted(() => ({
  rows: [] as Row[],
  calls: [] as { sql: string; args: unknown[] }[],
  /** The guard read returns nothing (a concurrent proof it could not see yet). */
  guardBlind: false,
  /** The guard read fails (DB error). */
  guardThrows: false,
  /** The legacy claims read returns nothing (a claim it could not see yet). */
  legacyBlind: false,
  /** The legacy claims read fails (DB error). */
  legacyThrows: false,
}));

vi.mock('@/lib/db', () => {
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
  const out = (r: Row) => ({
    ...r, display_hint: null, registered_at: '2026-09-01 00:00:00',
    monitor_url: null, monitor_status: null, monitor_checked_at: null,
  });
  const isLegacy = (r: Row) => r.legacy_unbound || (r.proof_method === 'micro_deposit' && !r.bound_test_proven);
  const execute = async (stmt: { sql: string; args?: unknown[] }) => {
    const sql = flat(stmt.sql);
    const args = stmt.args ?? [];
    store.calls.push({ sql, args });
    // Schema and the cold-start backfills (ensureVerifyTables).
    if (/^(CREATE|ALTER) /.test(sql)
      || sql.startsWith('UPDATE verify_destinations d SET legacy_unbound')
      || sql.startsWith('UPDATE verify_destinations SET domain_anchored_at = proven_at WHERE')
      || sql.startsWith('UPDATE verify_destinations SET proof_domain = NULL, last_confirmed_at = NULL WHERE')) {
      return { rows: [] };
    }
    if (sql.startsWith('UPDATE verify_domain_proofs') || sql.startsWith('UPDATE verify_deposit_challenges')) {
      return { rows: [] };
    }
    // A pending bound test (rule bound_v1) that has not expired.
    if (sql.startsWith('SELECT status, issued_at, expires_at, expected_amount, unit, rule, last_outcome, last_checked_at, baseline FROM verify_deposit_challenges')) {
      return { rows: [{
        status: 'pending', issued_at: '2026-09-01 00:00:00', expires_at: '2099-01-01 00:00:00',
        expected_amount: '12345', unit: null, rule: 'bound_v1', last_outcome: null, last_checked_at: null, baseline: null,
      }] };
    }
    // The same-rail letter-case check (provenByAnotherTenant).
    const sameRail = sql.match(/^SELECT 1 FROM verify_destinations WHERE kind = 'address' AND proof_status = 'proven' AND rail = \? AND tenant_id <> \? AND (lower\(value\)|value) = \? LIMIT 1$/);
    if (sameRail) {
      const [rail, tenantId, v] = args as string[];
      const fold = sameRail[1] !== 'value';
      return { rows: store.rows.filter((r) => r.kind === 'address' && r.proof_status === 'proven' && r.rail === rail
        && r.tenant_id !== tenantId && (fold ? r.value.toLowerCase() : r.value) === v) };
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
    // This tenant's legacy unbound claims (legacyClaims).
    if (sql === `SELECT d.id, d.kind, d.value FROM verify_destinations d WHERE d.tenant_id = ? AND d.proof_status = 'proven' AND ${LEGACY_SQL('d')}`) {
      if (store.legacyThrows) throw new Error('connection reset');
      if (store.legacyBlind) return { rows: [] };
      return { rows: store.rows.filter((r) => r.tenant_id === args[0] && r.proof_status === 'proven' && isLegacy(r))
        .map((r) => ({ id: r.id, kind: r.kind, value: r.value })) };
    }
    // One destination's legacy check (isLegacyClaim).
    if (sql === `SELECT 1 FROM verify_destinations d WHERE d.id = ? AND d.tenant_id = ? AND d.proof_status = 'proven' AND ${LEGACY_SQL('d')} LIMIT 1`) {
      return { rows: store.rows.filter((r) => r.id === args[0] && r.tenant_id === args[1] && r.proof_status === 'proven' && isLegacy(r)) };
    }
    if (sql.startsWith('SELECT COUNT(*) AS cnt FROM verify_destinations WHERE tenant_id = ? AND kind = ?')) {
      return { rows: [{ cnt: store.rows.filter((r) => r.tenant_id === args[0] && r.kind === args[1]).length }] };
    }
    if (sql.startsWith('SELECT 1 FROM verify_destinations WHERE tenant_id = ? AND kind = ? AND value = ?')) {
      return { rows: store.rows.filter((r) => r.tenant_id === args[0] && r.kind === args[1] && r.value === args[2]) };
    }
    if (sql.startsWith('INSERT INTO verify_destinations')) {
      const [id, tenant_id, kind, rail, value, label, , proof_method, proof_status, proven_at] = args as any[];
      store.rows.push({
        id, tenant_id, kind, rail, value, label, proof_method, proof_status, proven_at,
        proof_domain: null, domain_anchored_at: null, last_confirmed_at: null, legacy_unbound: false, bound_test_proven: false,
      });
      return { rows: [] };
    }
    if (/FROM verify_destinations WHERE tenant_id = \? ORDER BY/.test(sql)) {
      return { rows: store.rows.filter((r) => r.tenant_id === args[0]).map(out) };
    }
    // The public lookup (lookupVerifiedAddress): no platform lists here, then the merchant half.
    // It honors what the SQL asks for, so dropping the case arm or the fixed order shows up.
    if (sql.startsWith('SELECT m.chain AS chain')) return { rows: [] };
    if (sql.startsWith('SELECT tenant_id, rail, value, label,')
      && sql.includes("FROM verify_destinations WHERE kind = 'address' AND proof_status = 'proven' AND (value = ? OR lower(value) = ?)")) {
      const [exact, folded] = args as string[];
      const rows = store.rows.filter((r) => r.kind === 'address' && r.proof_status === 'proven'
        && (r.value === exact || r.value.toLowerCase() === folded));
      if (sql.endsWith('ORDER BY proven_at ASC, id ASC')) {
        rows.sort((a, b) => String(a.proven_at).localeCompare(String(b.proven_at)) || a.id.localeCompare(b.id));
      } else {
        rows.reverse(); // no fixed order: the database may return them in any order
      }
      return { rows };
    }
    if (sql.startsWith('SELECT display_name, domain FROM verify_claimed_names WHERE tenant_id = ?')) return { rows: [] };
    // The watchman's Pass B: the addresses anchored to a domain, and what it writes to them.
    if (/FROM verify_destinations WHERE tenant_id = \? AND proof_domain = \? AND proof_status = 'proven' AND kind = 'address'$/.test(sql)) {
      return { rows: store.rows.filter((r) => r.tenant_id === args[0] && r.proof_domain === args[1]
        && r.proof_status === 'proven' && r.kind === 'address').map(out) };
    }
    if (sql === "UPDATE verify_destinations SET proof_status = 'lapsed', updated_at = ? WHERE id = ? AND tenant_id = ? AND proof_method = 'well_known' AND proof_domain = ?") {
      const [, id, tenantId, domain] = args as string[];
      const row = store.rows.find((r) => r.id === id && r.tenant_id === tenantId && r.proof_method === 'well_known' && r.proof_domain === domain);
      if (row) row.proof_status = 'lapsed';
      return { rows: [], rowsAffected: row ? 1 : 0 };
    }
    if (sql === "UPDATE verify_destinations SET proof_domain = NULL, domain_anchored_at = NULL, last_confirmed_at = NULL, updated_at = ? WHERE id = ? AND tenant_id = ? AND proof_method <> 'well_known' AND proof_domain = ?") {
      const [, id, tenantId, domain] = args as string[];
      const row = store.rows.find((r) => r.id === id && r.tenant_id === tenantId && r.proof_method !== 'well_known' && r.proof_domain === domain);
      if (row) Object.assign(row, { proof_domain: null, domain_anchored_at: null, last_confirmed_at: null });
      return { rows: [], rowsAffected: row ? 1 : 0 };
    }
    if (sql === 'UPDATE verify_destinations SET last_confirmed_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?') {
      const [confirmedAt, , id, tenantId] = args as string[];
      const row = store.rows.find((r) => r.id === id && r.tenant_id === tenantId);
      if (row) row.last_confirmed_at = confirmedAt;
      return { rows: [], rowsAffected: row ? 1 : 0 };
    }
    if (/FROM verify_destinations WHERE id = \? AND tenant_id = \?$/.test(sql)) {
      return { rows: store.rows.filter((r) => r.id === args[0] && r.tenant_id === args[1]).map(out) };
    }
    // The two flips: the file (well_known) and the self-send (micro_deposit). The self-send
    // WHERE also admits a proven legacy claim taking the test again in place.
    if (sql.startsWith("UPDATE verify_destinations SET proof_status = 'proven'")) {
      const [id, tenantId] = args.slice(-2) as string[];
      const inPlace = sql.includes(`(proof_status <> 'proven' OR ${LEGACY_SQL('verify_destinations')})`);
      const row = store.rows.find((r) => r.id === id && r.tenant_id === tenantId
        && (r.proof_status !== 'proven' || (inPlace && isLegacy(r))));
      if (!row) return { rows: [], rowsAffected: 0 };
      // The real partial unique index on the RAW (rail, value) of proven address rows.
      if (store.rows.some((r) => r !== row && r.kind === 'address' && r.proof_status === 'proven'
        && r.rail === row.rail && r.value === row.value)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      }
      const wellKnown = sql.includes("'well_known'");
      row.proof_status = 'proven';
      row.proof_method = wellKnown ? 'well_known' : 'micro_deposit';
      row.proof_domain = wellKnown ? String(args[0]) : null;
      row.proven_at = String(wellKnown ? args[1] : args[0]);
      row.domain_anchored_at = wellKnown ? String(args[2]) : null;
      row.last_confirmed_at = wellKnown ? String(args[3]) : null;
      if (sql.includes('legacy_unbound = false,')) row.legacy_unbound = false;
      if (!wellKnown) row.bound_test_proven = true; // its bound test is marked proven next
      return { rows: [], rowsAffected: 1 };
    }
    // A NEW domain anchor on an already-proven address. Keeps the WHERE: proven, not a legacy
    // claim, and no anchor yet (or a leftover domain with no anchor date).
    if (sql.startsWith('UPDATE verify_destinations SET proof_domain = ?, domain_anchored_at = ?, last_confirmed_at = ?')) {
      const [domain, anchoredAt, confirmedAt, , id, tenantId] = args as string[];
      const legacyChecked = sql.includes(`AND NOT ${LEGACY_SQL('verify_destinations')}`);
      const row = store.rows.find((r) => r.id === id && r.tenant_id === tenantId && r.kind === 'address'
        && r.proof_status === 'proven' && !(legacyChecked && isLegacy(r))
        && (r.proof_domain === null || (r.domain_anchored_at === null && r.proof_method !== 'well_known')));
      if (!row) return { rows: [], rowsAffected: 0 };
      Object.assign(row, { proof_domain: domain, domain_anchored_at: anchoredAt, last_confirmed_at: confirmedAt });
      return { rows: [], rowsAffected: 1 };
    }
    // A re-confirm of the SAME anchor: keeps its date (COALESCE to proven_at for a file-proven
    // row anchored before the column existed).
    if (sql.startsWith('UPDATE verify_destinations SET domain_anchored_at = COALESCE(domain_anchored_at, proven_at), last_confirmed_at = ?')) {
      const [confirmedAt, , id, tenantId, domain] = args as string[];
      const legacyChecked = sql.includes(`AND NOT ${LEGACY_SQL('verify_destinations')}`);
      const row = store.rows.find((r) => r.id === id && r.tenant_id === tenantId && r.kind === 'address'
        && r.proof_status === 'proven' && !(legacyChecked && isLegacy(r)) && r.proof_domain === domain
        && (r.domain_anchored_at !== null || r.proof_method === 'well_known'));
      if (!row) return { rows: [], rowsAffected: 0 };
      Object.assign(row, { domain_anchored_at: row.domain_anchored_at ?? row.proven_at, last_confirmed_at: confirmedAt });
      return { rows: [], rowsAffected: 1 };
    }
    // The published-page check (Pass C): 'present' advances the confirmation of a payment
    // link only (the CASE on kind); every other outcome records the attempt only.
    if (sql.startsWith('UPDATE verify_destinations SET monitor_status = ?, monitor_checked_at = ?')) {
      const [id, tenantId] = args.slice(-2) as string[];
      const row = store.rows.find((r) => r.id === id && r.tenant_id === tenantId);
      if (!row) return { rows: [], rowsAffected: 0 };
      if (sql.includes("last_confirmed_at = CASE WHEN kind = 'qr' THEN ? ELSE last_confirmed_at END")) {
        if (row.kind === 'qr') row.last_confirmed_at = String(args[2]);
      } else if (sql.includes('last_confirmed_at = ?')) {
        row.last_confirmed_at = String(args[2]);
      }
      return { rows: [], rowsAffected: 1 };
    }
    throw new Error(`fake db: unexpected SQL: ${sql}`);
  };
  return { db: { execute, batch: async () => { throw new Error('fake db: batch not supported'); } } };
});

// The self-send path reads the chain; stub it to "the bound self-send was found". No rail
// needs a baseline here, so the guard is reached on every rail under test.
vi.mock('../../src/lib/verifyDeposit', () => ({
  detectBoundSelfSend: vi.fn(async () => ({ found: true, ref: '0xtxref' })),
  captureSelfSendBaseline: vi.fn(async () => null),
  parseSelfSendBaseline: vi.fn(() => null),
  railNeedsBaseline: vi.fn(() => false),
}));

import {
  claimFamily, claimIdentity, sameClaimIdentity, canAnchor, isClaimedElsewhere, ensureVerifyTables,
  recordProofResult, verifyMicroDeposit, createDestination, issueDepositChallenge, getDepositChallenge,
  listDestinationsForOwner, recordMonitorResult, addressKey, compareToDestinations,
  getProvenAddressDestinations, recheckDomainListing,
} from '../../src/lib/verifyRegistry';
import { merchantAddressAssurance } from '../../src/lib/verifyAnchor';
import { lookupVerifiedAddress } from '../../src/lib/verifyEntities';

const CHECKSUM = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const LOWER = CHECKSUM.toLowerCase();
const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
/** The same segwit address as it appears in a QR code (BIP-173 recommends uppercase there). */
const BTC_UP = BTC.toUpperCase();
const LTC = 'ltc1qg82tkln7qz9uq4zms9p6kwhnxsdjqm5vdzrrgy';
const SOL = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
/** Every rail a bitcoin value can be re-filed under in createDestination (plus a legacy
 *  off-list spelling), other than its own. */
const OTHER_RAILS_FOR_BTC = ['litecoin', 'solana', 'ethereum', 'polygon', 'avalanche', 'btc'];

/** A row; a proven self-send row counts as bound (bound_test_proven) unless it says otherwise. */
function row(p: Partial<Row> & Pick<Row, 'id' | 'tenant_id' | 'rail' | 'value'>): Row {
  return {
    kind: 'address', label: null, proof_status: 'unproven', proof_method: 'none', proof_domain: null,
    proven_at: p.proof_status === 'proven' ? '2026-08-01 00:00:00' : null,
    domain_anchored_at: null, last_confirmed_at: null, legacy_unbound: false, bound_test_proven: true, ...p,
  };
}
const guardCalls = () => store.calls.filter((c) => c.sql.startsWith(GUARD_SQL));
const flipCalls = () => store.calls.filter((c) => c.sql.startsWith("UPDATE verify_destinations SET proof_status = 'proven'"));
/** New anchors and re-confirms of an already-proven address. */
const anchorCalls = () => store.calls.filter((c) => c.sql.startsWith('UPDATE verify_destinations SET proof_domain = ?, domain_anchored_at = ?')
  || c.sql.startsWith('UPDATE verify_destinations SET domain_anchored_at = COALESCE'));
const newAnchorCalls = () => store.calls.filter((c) => c.sql.startsWith('UPDATE verify_destinations SET proof_domain = ?, domain_anchored_at = ?'));
const reconfirmCalls = () => store.calls.filter((c) => c.sql.startsWith('UPDATE verify_destinations SET domain_anchored_at = COALESCE'));
const writes = () => store.calls.filter((c) => c.sql.startsWith('UPDATE '));
const claimedNameCalls = () => store.calls.filter((c) => c.sql.includes('verify_claimed_names'));
/** recordProofResult's result with every list empty, overridden by `p`. */
const proof = (p: Partial<Record<'flipped' | 'otherDomain' | 'claimedElsewhere' | 'legacyUnbound', string[]>>) =>
  ({ flipped: [], otherDomain: [], claimedElsewhere: [], legacyUnbound: [], ...p });

// The schema and its cold-start backfills (some of them UPDATEs) run once, here, so no test's
// statement log depends on which test happened to run first.
beforeAll(async () => { await ensureVerifyTables(); });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  store.rows = [];
  store.calls = [];
  store.guardBlind = false;
  store.guardThrows = false;
  store.legacyBlind = false;
  store.legacyThrows = false;
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
    expect(res).toEqual(proof({ claimedElsewhere: ['twin'] }));
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
    expect(res).toEqual(proof({ claimedElsewhere: ['poly'] }));
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
      expect(res, rail).toEqual(proof({ claimedElsewhere: ['twin'] }));
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
      .toEqual(proof({ claimedElsewhere: ['twin'] }));

    // A pre-allowlist row on a spelling like 'btc' still anchors the wallet.
    store.rows = [
      row({ id: 'legacy', tenant_id: 'merchant', rail: 'btc', value: BTC, proof_status: 'proven' }),
      row({ id: 'twin', tenant_id: 'attacker', rail: 'bitcoin', value: BTC }),
    ];
    expect(await recordProofResult('attacker', 'attacker.example', [BTC]))
      .toEqual(proof({ claimedElsewhere: ['twin'] }));
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
    // Guard ran once per row that gets a new claim: the two flips AND the new anchor on the
    // self-send-proven one (an anchor lifts it to Verified, so it is a new public claim).
    expect(guardCalls()).toHaveLength(3);
    expect(flipCalls()).toHaveLength(2);
    expect(anchorCalls()).toHaveLength(1);
    expect(store.rows.find((r) => r.id === 'poly')!.proof_status).toBe('proven');
    expect(store.rows.find((r) => r.id === 'btc')!.proof_domain).toBe('merchant.example');
    // The self-send proof keeps its method; only the domain is attached.
    expect(store.rows.find((r) => r.id === 'eth')).toMatchObject({
      proof_status: 'proven', proof_method: 'micro_deposit', proof_domain: 'merchant.example',
    });
  });

  it('holds out a self-send-proven wallet from a new anchor when another account holds a canonical twin', async () => {
    // A pre-S5a twin: two accounts hold the same wallet (in different case) as proven. Neither
    // may be lifted to Verified by a listing while the claim is ambiguous.
    store.rows = [
      row({ id: 'other', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven', proof_method: 'micro_deposit' }),
      row({ id: 'mine', tenant_id: 'second', rail: 'ethereum', value: LOWER, proof_status: 'proven', proof_method: 'micro_deposit' }),
    ];
    const res = await recordProofResult('second', 'second.example', [LOWER]);
    expect(res).toEqual(proof({ claimedElsewhere: ['mine'] }));
    expect(anchorCalls()).toHaveLength(0);
    expect(store.rows.find((r) => r.id === 'mine')!.proof_domain).toBeNull();
  });

  it('re-confirms an address already anchored to this domain without re-running the guard', async () => {
    store.rows = [row({
      id: 'eth', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven',
      proof_method: 'micro_deposit', proof_domain: 'merchant.example', domain_anchored_at: '2026-09-01 00:00:00',
    })];
    const res = await recordProofResult('merchant', 'merchant.example', [CHECKSUM]);
    expect(res).toEqual(proof({ flipped: ['eth'] }));
    expect(guardCalls()).toHaveLength(0);
    expect(anchorCalls()).toHaveLength(1);
    // The anchor keeps its original date.
    expect(store.rows[0].domain_anchored_at).toBe('2026-09-01 00:00:00');
  });

  it('re-confirms a file-proven row anchored before domain_anchored_at existed: its date becomes proven_at', async () => {
    store.rows = [row({
      id: 'eth', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven',
      proof_method: 'well_known', proof_domain: 'merchant.example', proven_at: '2026-05-01 12:00:00',
    })];
    const res = await recordProofResult('merchant', 'merchant.example', [CHECKSUM]);
    expect(res).toEqual(proof({ flipped: ['eth'] }));
    expect(guardCalls()).toHaveLength(0);
    expect(reconfirmCalls()).toHaveLength(1);
    expect(store.rows[0].domain_anchored_at).toBe('2026-05-01 12:00:00');
  });

  it('a leftover self-send domain with no anchor date gets a NEW anchor: guarded, dated now', async () => {
    // Not a re-confirm: the public lookup never called it Verified, so lifting it is a new claim.
    store.rows = [row({
      id: 'eth', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven',
      proof_method: 'micro_deposit', proof_domain: 'merchant.example',
    })];
    const res = await recordProofResult('merchant', 'merchant.example', [CHECKSUM]);
    expect(res).toEqual(proof({ flipped: ['eth'] }));
    expect(guardCalls()).toHaveLength(1);
    expect(newAnchorCalls()).toHaveLength(1);
    expect(reconfirmCalls()).toHaveLength(0);
    const anchoredAt = newAnchorCalls()[0].args[1];
    expect(store.rows[0]).toMatchObject({ proof_domain: 'merchant.example', domain_anchored_at: anchoredAt });

    // The same leftover is held out when another account holds the wallet.
    store.rows = [
      row({ id: 'other', tenant_id: 'other', rail: 'ethereum', value: LOWER, proof_status: 'proven', proof_method: 'micro_deposit' }),
      row({ id: 'eth', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven', proof_method: 'micro_deposit', proof_domain: 'merchant.example' }),
    ];
    store.calls = [];
    expect(await recordProofResult('merchant', 'merchant.example', [CHECKSUM])).toEqual(proof({ claimedElsewhere: ['eth'] }));
    expect(anchorCalls()).toHaveLength(0);
  });

  it('a leftover domain of ANOTHER domain is replaced, not stuck as other_domain', async () => {
    store.rows = [row({
      id: 'eth', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven',
      proof_method: 'micro_deposit', proof_domain: 'old.example',
    })];
    expect(await recordProofResult('merchant', 'merchant.example', [CHECKSUM])).toEqual(proof({ flipped: ['eth'] }));
    expect(store.rows[0].proof_domain).toBe('merchant.example');
  });

  it('never moves an address anchored to a different domain', async () => {
    store.rows = [row({
      id: 'eth', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven',
      proof_method: 'micro_deposit', proof_domain: 'merchant.example', domain_anchored_at: '2026-09-01 00:00:00',
    })];
    const res = await recordProofResult('merchant', 'merchant-pay.example', [CHECKSUM]);
    expect(res).toEqual(proof({ otherDomain: ['eth'] }));
    expect(writes().filter((c) => c.sql.startsWith('UPDATE verify_destinations'))).toHaveLength(0);
    expect(store.rows[0].proof_domain).toBe('merchant.example');
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
    expect(res).toEqual(proof({ claimedElsewhere: ['dup'] }));
    expect(flipCalls()).toHaveLength(1);
    expect(store.rows.find((r) => r.id === 'dup')!.proof_status).toBe('unproven');
  });

  it('fails closed when the guard cannot read: nothing flips and nothing is blamed on another account', async () => {
    store.rows = [row({ id: 'btc', tenant_id: 'merchant', rail: 'bitcoin', value: BTC })];
    store.guardThrows = true;
    const res = await recordProofResult('merchant', 'merchant.example', [BTC]);
    expect(res).toEqual(proof({}));
    expect(flipCalls()).toHaveLength(0);
  });
});

describe('the .well-known file never anchors a legacy unbound claim', () => {
  // legacy_unbound: proven under the old self-send rule, where any new outgoing transaction
  // counted, whoever made it. It may be a squat, so no listing may lift it to Verified.
  const legacyRow = (p: Partial<Row> = {}) => row({
    id: 'legacy', tenant_id: 'merchant', rail: 'bitcoin', value: BTC, proof_status: 'proven',
    proof_method: 'micro_deposit', legacy_unbound: true, bound_test_proven: false, ...p,
  });

  it('reports it as needing a re-proof and leaves it Claimed', async () => {
    store.rows = [legacyRow()];
    const res = await recordProofResult('merchant', 'merchant.example', [BTC]);
    expect(res).toEqual(proof({ legacyUnbound: ['legacy'] }));
    expect(anchorCalls()).toHaveLength(0);
    expect(flipCalls()).toHaveLength(0);
    expect(store.rows[0]).toMatchObject({ proof_status: 'proven', proof_method: 'micro_deposit', proof_domain: null, domain_anchored_at: null });
  });

  it('does not re-confirm a legacy claim that carries a leftover domain', async () => {
    store.rows = [legacyRow({ proof_domain: 'merchant.example' })];
    const res = await recordProofResult('merchant', 'merchant.example', [BTC]);
    expect(res).toEqual(proof({ legacyUnbound: ['legacy'] }));
    expect(anchorCalls()).toHaveLength(0);
    expect(store.rows[0].domain_anchored_at).toBeNull();
  });

  it('still anchors the same account’s bound claims in the same proof', async () => {
    store.rows = [
      legacyRow(),
      row({ id: 'bound', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven', proof_method: 'micro_deposit' }),
    ];
    const res = await recordProofResult('merchant', 'merchant.example', [BTC, CHECKSUM]);
    expect(res).toEqual(proof({ flipped: ['bound'], legacyUnbound: ['legacy'] }));
    expect(store.rows.find((r) => r.id === 'bound')!.proof_domain).toBe('merchant.example');
    expect(store.rows.find((r) => r.id === 'legacy')!.proof_domain).toBeNull();
  });

  it('refuses a same-account checksum/lowercase twin of the legacy wallet: no flip, no anchor', async () => {
    // The twin is unproven, so without the check it would be flipped to well_known under the
    // listing (the S5a guard skips the caller's own account), and the public lookup, which
    // matches every spelling, would answer Verified for the squatted wallet.
    store.rows = [
      legacyRow({ rail: 'ethereum', value: CHECKSUM }),
      row({ id: 'twin', tenant_id: 'merchant', rail: 'ethereum', value: LOWER }),
    ];
    const res = await recordProofResult('merchant', 'squat.example', [LOWER]);
    expect(res).toEqual(proof({ legacyUnbound: ['legacy', 'twin'] }));
    expect(flipCalls()).toHaveLength(0);
    expect(anchorCalls()).toHaveLength(0);
    expect(store.rows.find((r) => r.id === 'twin')).toMatchObject({ proof_status: 'unproven', proof_domain: null });
  });

  it('refuses a same-account URI-wrapped twin of a non-EVM legacy wallet', async () => {
    store.rows = [
      legacyRow(),
      row({ id: 'twin', tenant_id: 'merchant', rail: 'bitcoin', value: `bitcoin:${BTC}?amount=0.1` }),
    ];
    const res = await recordProofResult('merchant', 'squat.example', [BTC]);
    expect(res).toEqual(proof({ legacyUnbound: ['legacy', 'twin'] }));
    expect(flipCalls()).toHaveLength(0);
    expect(store.rows.find((r) => r.id === 'twin')!.proof_status).toBe('unproven');
  });

  it('a twin with a bound self-send of its own is anchored (that proof stands on its own)', async () => {
    store.rows = [
      legacyRow({ rail: 'ethereum', value: CHECKSUM }),
      row({ id: 'bound', tenant_id: 'merchant', rail: 'polygon', value: LOWER, proof_status: 'proven', proof_method: 'micro_deposit' }),
    ];
    const res = await recordProofResult('merchant', 'merchant.example', [LOWER]);
    expect(res).toEqual(proof({ flipped: ['bound'], legacyUnbound: ['legacy'] }));
  });

  it('another account’s legacy claim does not taint this account’s rows', async () => {
    // (This account's row is then held out by the S5a guard as claimed elsewhere instead.)
    store.rows = [
      legacyRow({ tenant_id: 'other' }),
      row({ id: 'mine', tenant_id: 'merchant', rail: 'bitcoin', value: BTC }),
    ];
    const res = await recordProofResult('merchant', 'merchant.example', [BTC]);
    expect(res).toEqual(proof({ claimedElsewhere: ['mine'] }));
  });

  it('counts an untagged claim the backfill never reached (no bound test proved): it is not anchored', async () => {
    store.rows = [legacyRow({ legacy_unbound: false, bound_test_proven: false })];
    const res = await recordProofResult('merchant', 'merchant.example', [BTC]);
    expect(res).toEqual(proof({ legacyUnbound: ['legacy'] }));
    expect(anchorCalls()).toHaveLength(0);
  });

  it('the anchor UPDATE re-checks the live legacy rule: a claim the read missed is not anchored', async () => {
    store.rows = [legacyRow()];
    store.legacyBlind = true; // the read missed it (e.g. a concurrent change)
    const res = await recordProofResult('merchant', 'merchant.example', [BTC]);
    expect(newAnchorCalls()).toHaveLength(1);
    expect(newAnchorCalls()[0].sql).toContain(`AND NOT ${LEGACY_SQL('verify_destinations')}`);
    expect(res).toEqual(proof({}));
    expect(store.rows[0].proof_domain).toBeNull();
  });

  it('a lapsed row with a stale tag is not a current claim: the file flips it and clears the tag', async () => {
    store.rows = [legacyRow({ proof_status: 'lapsed', proof_method: 'well_known', proof_domain: 'old.example' })];
    const res = await recordProofResult('merchant', 'merchant.example', [BTC]);
    expect(res).toEqual(proof({ flipped: ['legacy'] }));
    expect(flipCalls()[0].sql).toContain('legacy_unbound = false');
    expect(store.rows[0]).toMatchObject({
      proof_status: 'proven', proof_method: 'well_known', proof_domain: 'merchant.example', legacy_unbound: false,
    });
  });

  it('fails closed when the claims cannot be read: nothing is written, not even the domain proof', async () => {
    store.rows = [legacyRow()];
    store.legacyThrows = true;
    await expect(recordProofResult('merchant', 'merchant.example', [BTC])).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });

  it('reads the claims for the calling tenant only', async () => {
    store.rows = [legacyRow({ id: 'theirs', tenant_id: 'other', value: SOL, rail: 'solana' })];
    await recordProofResult('merchant', 'merchant.example', [BTC]);
    const read = store.calls.find((c) => c.sql.startsWith('SELECT d.id, d.kind, d.value FROM verify_destinations d WHERE d.tenant_id = ?'))!;
    expect(read.args).toEqual(['merchant']);
  });

  it('lends the refused row’s label no business name', async () => {
    store.rows = [legacyRow({ label: 'Merchant' })];
    await recordProofResult('merchant', 'merchant.example', [BTC]);
    expect(claimedNameCalls()).toHaveLength(0);
    // A row the proof did not refuse still does (the name registry itself is not modeled here).
    store.rows = [legacyRow({ label: 'Merchant', legacy_unbound: false, bound_test_proven: true })];
    await recordProofResult('merchant', 'merchant.example', [BTC]);
    expect(claimedNameCalls().length).toBeGreaterThan(0);
  });
});

describe('a legacy claim takes the satoshi test again in place', () => {
  const legacyRow = (p: Partial<Row> = {}) => row({
    id: 'legacy', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven',
    proof_method: 'micro_deposit', legacy_unbound: true, bound_test_proven: false, ...p,
  });

  it('flags it for the owner’s dashboard only', async () => {
    store.rows = [legacyRow(), row({ id: 'bound', tenant_id: 'merchant', rail: 'bitcoin', value: BTC, proof_status: 'proven', proof_method: 'micro_deposit' })];
    const list = await listDestinationsForOwner('merchant');
    expect(list.map((d) => [d.id, d.needsReproof])).toEqual([['legacy', true], ['bound', false]]);
  });

  it('re-proves the same row: it keeps its claim the whole time, then the tag is cleared', async () => {
    store.rows = [legacyRow({ proven_at: '2026-01-01 00:00:00' })];
    expect(await getDepositChallenge('merchant', 'legacy')).toMatchObject({ ok: true });
    expect(await verifyMicroDeposit('merchant', 'legacy')).toEqual({ outcome: 'proven', ref: '0xtxref' });
    expect(flipCalls()[0].sql).toContain(`(proof_status <> 'proven' OR ${LEGACY_SQL('verify_destinations')})`);
    expect(store.rows[0]).toMatchObject({ proof_status: 'proven', proof_method: 'micro_deposit', legacy_unbound: false });
    // proven_at is now the date control was actually shown.
    expect(store.rows[0].proven_at).not.toBe('2026-01-01 00:00:00');
    // Then a domain proof anchors it.
    expect(await recordProofResult('merchant', 'merchant.example', [CHECKSUM])).toEqual(proof({ flipped: ['legacy'] }));
  });

  it('a bound claim is not offered the test again', async () => {
    store.rows = [legacyRow({ legacy_unbound: false, bound_test_proven: true })];
    expect(await issueDepositChallenge('merchant', 'legacy')).toEqual({ ok: false, error: 'already_proven' });
    expect(await verifyMicroDeposit('merchant', 'legacy')).toEqual({ outcome: 'already_proven' });
    expect(await getDepositChallenge('merchant', 'legacy')).toEqual({ ok: true, challenge: null });
  });

  it('still runs the claim guard: a canonical twin another account proved holds it out, and the row stays as it was', async () => {
    store.rows = [
      legacyRow(),
      row({ id: 'other', tenant_id: 'other', rail: 'ethereum', value: LOWER, proof_status: 'proven', proof_method: 'well_known' }),
    ];
    expect(await verifyMicroDeposit('merchant', 'legacy')).toEqual({ outcome: 'claimed_elsewhere' });
    expect(store.rows[0]).toMatchObject({ proof_status: 'proven', legacy_unbound: true });
  });
});

describe('a published-page check never keeps an address anchor fresh (Pass C)', () => {
  const CUTOFF = '2026-09-23 00:00:00';
  const assurance = (r: Row) => merchantAddressAssurance({
    proofMethod: r.proof_method, proofDomain: r.proof_domain, provenAt: r.proven_at,
    domainAnchoredAt: r.domain_anchored_at, lastConfirmedAt: r.last_confirmed_at,
  }, CUTOFF);

  it('a stale anchor plus a "present" page check stays Claimed', async () => {
    store.rows = [row({
      id: 'eth', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven', proof_method: 'micro_deposit',
      proof_domain: 'merchant.example', domain_anchored_at: '2026-09-01 00:00:00', last_confirmed_at: '2026-09-10 00:00:00',
    })];
    await recordMonitorResult('merchant', 'eth', 'present');
    expect(store.rows[0].last_confirmed_at).toBe('2026-09-10 00:00:00');
    expect(assurance(store.rows[0]).level).toBe('claimed');
  });

  it('a payment link’s "present" check still confirms it', async () => {
    store.rows = [row({ id: 'q', tenant_id: 'merchant', kind: 'qr', rail: 'url', value: 'https://buy.example.com/x', proof_status: 'proven' })];
    await recordMonitorResult('merchant', 'q', 'present');
    expect(store.rows[0].last_confirmed_at).not.toBeNull();
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

  it('a bound self-send is a fresh control proof: it clears any legacy tag and any leftover anchor', async () => {
    store.rows = [row({
      id: 'eth', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'lapsed',
      proof_method: 'well_known', proof_domain: 'old.example', domain_anchored_at: '2026-01-01 00:00:00', legacy_unbound: true,
    })];
    expect(await verifyMicroDeposit('merchant', 'eth')).toEqual({ outcome: 'proven', ref: '0xtxref' });
    expect(flipCalls()[0].sql).toContain('legacy_unbound = false');
    expect(store.rows[0]).toMatchObject({
      proof_status: 'proven', proof_method: 'micro_deposit', proof_domain: null, domain_anchored_at: null, legacy_unbound: false,
    });
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

describe('segwit letter case: BC1Q… and bc1q… are one wallet', () => {
  // bech32 is case-insensitive (BIP-173) and QR codes carry it in uppercase. The guard, the
  // listing match and the public lookup must all see one wallet, or an uppercase copy passes
  // the guard as a second wallet and then answers the lookup as the same one.
  const NOW = new Date().toISOString().replace('T', ' ').slice(0, 19);
  /** A fresh domain anchor: what reads Verified. */
  const anchored = (domain: string) => ({
    proof_domain: domain, domain_anchored_at: NOW, last_confirmed_at: NOW,
  });

  it('keys a segwit address in lowercase, in any case and inside a URI; base58 keeps its case', () => {
    expect(addressKey(BTC_UP)).toBe(BTC);
    expect(addressKey(`bitcoin:${BTC_UP}?amount=0.1`)).toBe(BTC);
    expect(addressKey(`bC1Q${BTC.slice(4)}`)).toBe(BTC); // mixed case: invalid, but the same wallet
    expect(addressKey(LTC.toUpperCase())).toBe(LTC);
    expect(addressKey(SOL)).toBe(SOL);
    // A base58 string that merely starts with "bc1" is not segwit: 'i' is outside the bech32 set.
    const base58 = `bc1Hi${SOL.slice(5)}`;
    expect(addressKey(base58)).toBe(base58);
    expect(claimIdentity('address', BTC_UP)).toEqual({ canonical: BTC, family: 'addr' });
    expect(sameClaimIdentity(claimIdentity('address', BTC_UP), claimIdentity('address', BTC))).toBe(true);
    expect(canAnchor(claimIdentity('address', BTC_UP), [claimIdentity('address', `bitcoin:${BTC}`)])).toBe(false);
  });

  it('the guard sees another account’s wallet in the other case', async () => {
    store.rows = [row({ id: 'real', tenant_id: 'merchant', rail: 'bitcoin', value: BTC, proof_status: 'proven', proof_method: 'micro_deposit' })];
    expect(await isClaimedElsewhere('attacker', 'address', BTC_UP)).toBe(true);
    expect(await isClaimedElsewhere('attacker', 'address', `bC1Q${BTC.slice(4)}`)).toBe(true);
    store.rows = [row({ id: 'real', tenant_id: 'merchant', rail: 'bitcoin', value: BTC_UP, proof_status: 'proven' })];
    expect(await isClaimedElsewhere('attacker', 'address', BTC)).toBe(true);
  });

  it('a file listing never lifts an uppercase copy of another account’s wallet: claimed elsewhere', async () => {
    for (const listed of [BTC_UP, BTC]) {
      store.rows = [
        row({ id: 'real', tenant_id: 'merchant', rail: 'bitcoin', value: BTC, proof_status: 'proven', proof_method: 'micro_deposit' }),
        row({ id: 'att', tenant_id: 'attacker', rail: 'bitcoin', value: BTC_UP }),
      ];
      store.calls = [];
      expect(await recordProofResult('attacker', 'attacker.example', [listed]), listed).toEqual(proof({ claimedElsewhere: ['att'] }));
      expect(flipCalls(), listed).toHaveLength(0);
      expect(store.rows.find((r) => r.id === 'att'), listed).toMatchObject({ proof_status: 'unproven', proof_domain: null });
    }
    // Nor anchors an uppercase copy that was proven before the guard could see it.
    store.rows = [
      row({ id: 'real', tenant_id: 'merchant', rail: 'bitcoin', value: BTC, proof_status: 'proven', proof_method: 'micro_deposit' }),
      row({ id: 'att', tenant_id: 'attacker', rail: 'litecoin', value: BTC_UP, proof_status: 'proven', proof_method: 'micro_deposit' }),
    ];
    store.calls = [];
    expect(await recordProofResult('attacker', 'attacker.example', [BTC_UP])).toEqual(proof({ claimedElsewhere: ['att'] }));
    expect(anchorCalls()).toHaveLength(0);
  });

  it('a self-send never takes an uppercase copy of another account’s wallet, under any rail', async () => {
    for (const rail of ['bitcoin', 'litecoin']) {
      store.rows = [
        row({ id: 'real', tenant_id: 'merchant', rail: 'bitcoin', value: BTC, proof_status: 'proven', proof_method: 'well_known' }),
        row({ id: 'att', tenant_id: 'attacker', rail, value: BTC_UP }),
      ];
      expect(await verifyMicroDeposit('attacker', 'att'), rail).toEqual({ outcome: 'claimed_elsewhere' });
      expect(store.rows.find((r) => r.id === 'att')!.proof_status, rail).toBe('unproven');
    }
  });

  it('refuses a same-account uppercase copy of a legacy claim, as for any other twin', async () => {
    store.rows = [
      row({
        id: 'legacy', tenant_id: 'merchant', rail: 'bitcoin', value: BTC, proof_status: 'proven',
        proof_method: 'micro_deposit', legacy_unbound: true, bound_test_proven: false,
      }),
      row({ id: 'twin', tenant_id: 'merchant', rail: 'bitcoin', value: BTC_UP }),
    ];
    expect(await recordProofResult('merchant', 'squat.example', [BTC_UP])).toEqual(proof({ legacyUnbound: ['legacy', 'twin'] }));
    expect(flipCalls()).toHaveLength(0);
    expect(store.rows.find((r) => r.id === 'twin')).toMatchObject({ proof_status: 'unproven', proof_domain: null });
  });

  it('a listing in the other case still vouches for the owner’s own address', async () => {
    store.rows = [
      row({ id: 'lower', tenant_id: 'merchant', rail: 'bitcoin', value: BTC }),
      row({ id: 'upper', tenant_id: 'merchant', rail: 'litecoin', value: LTC.toUpperCase(), proof_status: 'proven', proof_method: 'micro_deposit' }),
    ];
    const res = await recordProofResult('merchant', 'merchant.example', [BTC_UP, LTC]);
    expect(res).toEqual(proof({ flipped: ['lower', 'upper'] }));
    expect(store.rows.map((r) => r.proof_domain)).toEqual(['merchant.example', 'merchant.example']);
  });

  it('the public lookup answers for the wallet in either case', async () => {
    store.rows = [row({
      id: 'real', tenant_id: 'merchant', rail: 'bitcoin', value: BTC, proof_status: 'proven',
      proof_method: 'well_known', proven_at: NOW, ...anchored('merchant.example'),
    })];
    for (const q of [BTC, BTC_UP, `bitcoin:${BTC_UP}`]) {
      expect(await lookupVerifiedAddress(q), q).toMatchObject({ source: 'merchant', level: 'verified', domain: 'merchant.example' });
    }
    const call = store.calls.filter((c) => c.sql.includes('(value = ? OR lower(value) = ?)')).at(-1)!;
    expect(call.args).toEqual([BTC, BTC]);
    expect(call.sql).toMatch(/ORDER BY proven_at ASC, id ASC$/);
  });

  it('two accounts holding one wallet (proven before the guard saw case) never read Verified', async () => {
    // The earlier holder answers, in a fixed order, and nothing lifts it: whose domain stands
    // behind the wallet is exactly what can't be told.
    store.rows = [
      row({ id: 'att', tenant_id: 'attacker', rail: 'bitcoin', value: BTC_UP, proof_status: 'proven',
        proof_method: 'well_known', proven_at: NOW, ...anchored('attacker.example') }),
      row({ id: 'real', tenant_id: 'merchant', rail: 'bitcoin', value: BTC, proof_status: 'proven',
        proof_method: 'micro_deposit', proven_at: '2026-08-01 00:00:00' }),
    ];
    for (const q of [BTC, BTC_UP]) {
      expect(await lookupVerifiedAddress(q), q).toEqual({
        source: 'merchant', level: 'claimed', since: '2026-08-01 00:00:00', domain: null, label: null, chain: 'bitcoin',
      });
    }
  });

  it('within one account, a Verified row for the wallet answers, whatever the row order', async () => {
    store.rows = [
      row({ id: 'a-legacy', tenant_id: 'merchant', rail: 'bitcoin', value: BTC, proof_status: 'proven',
        proof_method: 'micro_deposit', proven_at: '2026-08-01 00:00:00' }),
      row({ id: 'b-bound', tenant_id: 'merchant', rail: 'litecoin', value: BTC_UP, proof_status: 'proven',
        proof_method: 'micro_deposit', proven_at: '2026-09-01 00:00:00', ...anchored('merchant.example') }),
    ];
    for (const q of [BTC, BTC_UP]) {
      expect(await lookupVerifiedAddress(q), q).toMatchObject({ level: 'verified', since: NOW, domain: 'merchant.example' });
    }
  });

  it('the owner’s compare matches the QR (uppercase) form of a registered address', async () => {
    store.rows = [row({ id: 'lower', tenant_id: 'merchant', rail: 'bitcoin', value: BTC })];
    expect(await compareToDestinations('merchant', BTC_UP)).toMatchObject({ matched: true, destination: { id: 'lower' } });
    expect(await compareToDestinations('merchant', SOL)).toMatchObject({ matched: false });
  });
});

describe('the watchman (Pass B) never keeps a listing that leans on a legacy claim', () => {
  // Before the owner's proof refused them (decideAnchor), a same-account copy of a legacy claim
  // could be file-flipped and anchored. Pass B re-confirms by id, so without this it would keep
  // such a copy Verified for as long as the file lists it.
  const T0 = '2026-09-01 00:00:00';
  const legacyRow = (p: Partial<Row> = {}) => row({
    id: 'legacy', tenant_id: 'merchant', rail: 'bitcoin', value: BTC, proof_status: 'proven',
    proof_method: 'micro_deposit', legacy_unbound: true, bound_test_proven: false, ...p,
  });
  const fileCopy = (p: Partial<Row>) => row({
    id: 'copy', tenant_id: 'merchant', rail: 'litecoin', value: BTC, proof_status: 'proven', proof_method: 'well_known',
    proven_at: T0, proof_domain: 'merchant.example', domain_anchored_at: T0, last_confirmed_at: T0, ...p,
  });
  const recheck = async (listed: string[]) => recheckDomainListing(
    'merchant', 'merchant.example', await getProvenAddressDestinations('merchant', 'merchant.example'), listed,
  );

  it('lapses a file-flipped copy (another rail, case or URI wrapping) instead of re-confirming it', async () => {
    for (const copy of [{}, { rail: 'bitcoin', value: BTC_UP }, { rail: 'bitcoin', value: `bitcoin:${BTC}?amount=1` }]) {
      store.rows = [legacyRow(), fileCopy(copy)];
      store.calls = [];
      const res = await recheck([BTC]);
      expect(res.legacyHeld.map((p) => p.id), JSON.stringify(copy)).toEqual(['copy']);
      expect(res).toMatchObject({ missing: [], confirmed: [] });
      expect(store.rows.find((r) => r.id === 'copy'), JSON.stringify(copy)).toMatchObject({ proof_status: 'lapsed', last_confirmed_at: T0 });
      // The legacy row itself is untouched: it keeps its claim and shows Claimed.
      expect(store.rows.find((r) => r.id === 'legacy')).toMatchObject({ proof_status: 'proven', proof_domain: null });
    }
  });

  it('still re-confirms a copy with a bound self-send of its own, and every row of an account with no legacy claim', async () => {
    store.rows = [legacyRow(), fileCopy({ proof_method: 'micro_deposit', bound_test_proven: true })];
    let res = await recheck([BTC]);
    expect(res).toMatchObject({ missing: [], legacyHeld: [], confirmed: ['copy'] });
    expect(store.rows.find((r) => r.id === 'copy')!.last_confirmed_at).not.toBe(T0);

    store.rows = [fileCopy({ id: 'plain', rail: 'bitcoin' })];
    res = await recheck([BTC_UP]); // listed in the QR case: the same wallet
    expect(res).toMatchObject({ missing: [], legacyHeld: [], confirmed: ['plain'] });
  });

  it('releases what the file dropped, as before', async () => {
    store.rows = [
      fileCopy({ id: 'file', rail: 'bitcoin' }),
      row({ id: 'self', tenant_id: 'merchant', rail: 'ethereum', value: CHECKSUM, proof_status: 'proven', proof_method: 'micro_deposit',
        proof_domain: 'merchant.example', domain_anchored_at: T0, last_confirmed_at: T0 }),
    ];
    const res = await recheck([]);
    expect(res.missing.map((p) => p.id)).toEqual(['file', 'self']);
    expect(store.rows.find((r) => r.id === 'file')!.proof_status).toBe('lapsed');
    expect(store.rows.find((r) => r.id === 'self')).toMatchObject({ proof_status: 'proven', proof_domain: null });
  });

  it('fails closed when the legacy claims cannot be read: nothing is released or re-confirmed', async () => {
    store.rows = [legacyRow(), fileCopy({})];
    store.legacyThrows = true;
    const proven = await getProvenAddressDestinations('merchant', 'merchant.example');
    store.calls = [];
    await expect(recheckDomainListing('merchant', 'merchant.example', proven, [BTC])).rejects.toThrow();
    expect(writes()).toHaveLength(0);
    expect(store.rows.find((r) => r.id === 'copy')).toMatchObject({ proof_status: 'proven', last_confirmed_at: T0 });
  });
});
