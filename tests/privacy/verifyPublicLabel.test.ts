import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Privacy audit 2026-10-10 (B-A3, B-A4, E-B1): the public, login-free Verify answers must
 * never carry the freeform label an account typed for a destination. It can be a person's
 * name, and a roster label is copied onto the destination it registers. Only a
 * domain-verified business name (verify_claimed_names) may go out, and /api/verify/lookup
 * sends a name or domain only for a Verified hit, the same rule the public cards follow.
 *
 * The database is an in-memory stand-in that answers only the statements these paths issue
 * and returns just the columns each SELECT names, so a query that starts reading the label
 * again would hand it to the code exactly as Postgres would.
 */
type Dest = {
  tenant_id: string; kind: 'address' | 'qr'; rail: string; value: string; label: string | null;
  proof_status: string; proof_method: string; proof_domain: string | null; proven_at: string | null;
  domain_anchored_at: string | null; last_confirmed_at: string | null; monitor_url: string | null;
};
type Name = { tenant_id: string; display_name: string; domain: string | null; created_at: string };

const mem = vi.hoisted(() => ({
  dests: [] as any[],
  names: [] as any[],
  selects: [] as string[],
}));

vi.mock('@/lib/db', () => {
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
  // Only the columns the statement asks for, as Postgres would return them.
  const project = (sql: string, rows: any[]) => {
    const cols = sql.slice('SELECT '.length, sql.indexOf(' FROM ')).split(',').map((c) => c.trim());
    return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
  };
  const execute = async (stmt: { sql: string; args?: unknown[] }) => {
    const sql = flat(stmt.sql);
    const args = (stmt.args ?? []) as string[];
    // Schema and cold-start backfills (ensureEntityTables, ensureVerifyTables).
    if (/^(CREATE|ALTER|UPDATE) /.test(sql)) return { rows: [], rowsAffected: 0 };
    // No platform publishes these values.
    if (sql.startsWith('SELECT m.chain AS chain')) return { rows: [] };
    if (sql.includes("FROM verify_destinations WHERE kind = 'address' AND proof_status = 'proven' AND (value = ? OR lower(value) = ?)")) {
      mem.selects.push(sql);
      const [exact, folded] = args;
      return { rows: project(sql, mem.dests.filter((d) => d.kind === 'address' && d.proof_status === 'proven'
        && (d.value === exact || d.value.toLowerCase() === folded))) };
    }
    if (/FROM verify_destinations WHERE kind = 'qr' AND proof_status = 'proven'$/.test(sql)) {
      mem.selects.push(sql);
      return { rows: project(sql, mem.dests.filter((d) => d.kind === 'qr' && d.proof_status === 'proven')) };
    }
    if (sql.startsWith('SELECT display_name, domain FROM verify_claimed_names WHERE tenant_id = ?')) {
      return { rows: project(sql, mem.names.filter((n) => n.tenant_id === args[0])) };
    }
    throw new Error(`unexpected statement: ${sql}`);
  };
  return { db: { execute, batch: async (stmts: any[]) => Promise.all(stmts.map(execute)) } };
});

import { GET as lookupGet } from '../../src/pages/api/verify/lookup';
import { GET as checkGet } from '../../src/pages/api/verify/check';
import { lookupVerifiedAddress, lookupVerifiedUrl } from '../../src/lib/verifyEntities';
import { normalizeDestinationValue } from '../../src/lib/verifyRegistry';

const WALLET = '0x' + 'ab'.repeat(20);
const LINK = 'https://buy.stripe.com/test_7sI4hk2Mc';
const TYPED = 'Jane Doe';
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function dest(over: Partial<Dest>): Dest {
  return {
    tenant_id: 'merchant', kind: 'address', rail: 'ethereum', value: WALLET, label: TYPED,
    proof_status: 'proven', proof_method: 'micro_deposit', proof_domain: null, proven_at: now(),
    domain_anchored_at: null, last_confirmed_at: null, monitor_url: null, ...over,
  };
}
/** Proven by the domain's own file and re-confirmed just now: answers Verified. */
const anchored = (domain: string): Partial<Dest> => ({
  proof_method: 'well_known', proof_domain: domain, domain_anchored_at: now(), last_confirmed_at: now(),
});
const businessName = (name: string, domain: string): Name =>
  ({ tenant_id: 'merchant', display_name: name, domain, created_at: now() });

let ip = 0;
async function lookup(value: string) {
  ip += 1;
  const url = new URL(`https://almstins.com/api/verify/lookup?address=${encodeURIComponent(value)}`);
  const request = new Request(url, { headers: { 'cf-connecting-ip': `203.0.113.${ip}` } });
  const res = await (lookupGet as any)({ request, url });
  const text = await res.text();
  return { text, body: JSON.parse(text) };
}
async function check(value: string) {
  ip += 1;
  const url = new URL(`https://almstins.com/api/verify/check?value=${encodeURIComponent(value)}`);
  const request = new Request(url, { headers: { 'cf-connecting-ip': `198.51.100.${ip}` } });
  const res = await (checkGet as any)({ request, url });
  const text = await res.text();
  return { text, body: JSON.parse(text) };
}

beforeEach(() => {
  mem.dests = [];
  mem.names = [];
  mem.selects = [];
});

describe('GET /api/verify/lookup never returns a typed label', () => {
  it('a proven address with a typed label and no verified business name: no label', async () => {
    mem.dests = [dest({ ...anchored('acme.com') })];
    const { body, text } = await lookup(WALLET);
    expect(body).toMatchObject({ ok: true, verified: true, level: 'verified', domain: 'acme.com', label: null });
    expect(text).not.toContain(TYPED);
  });

  it('a Claimed (self-send) address with a typed label: no label and no domain', async () => {
    mem.dests = [dest({})];
    const { body, text } = await lookup(WALLET);
    expect(body).toMatchObject({ ok: true, verified: true, level: 'claimed', domain: null, provingDomain: null, label: null });
    expect(text).not.toContain(TYPED);
  });

  it('with a verified business name, a Verified address returns that name', async () => {
    mem.dests = [dest({ ...anchored('acme.com') })];
    mem.names = [businessName('Acme', 'acme.com')];
    const { body, text } = await lookup(WALLET);
    expect(body).toMatchObject({ level: 'verified', domain: 'acme.com', provingDomain: 'acme.com', label: 'Acme' });
    expect(text).not.toContain(TYPED);
  });

  it('a Claimed address carries neither the business name nor its domain', async () => {
    mem.dests = [dest({})];
    mem.names = [businessName('Acme', 'acme.com')];
    const { body } = await lookup(WALLET);
    expect(body).toMatchObject({ level: 'claimed', domain: null, provingDomain: null, label: null });
  });

  it('a payment link: no label without a verified business name, the name with one', async () => {
    mem.dests = [dest({ kind: 'qr', rail: 'stripe', value: normalizeDestinationValue(LINK)!, proof_method: 'account_claim' })];
    const bare = await lookup(LINK);
    expect(bare.body).toMatchObject({ verified: true, level: 'claimed', domain: null, label: null, chain: 'url' });
    expect(bare.text).not.toContain(TYPED);

    mem.names = [businessName('Acme', 'acme.com')];
    const named = await lookup(LINK);
    expect(named.body).toMatchObject({ level: 'verified', domain: 'acme.com', label: 'Acme', chain: 'url' });
    expect(named.text).not.toContain(TYPED);
  });
});

describe('the shared lookups never read the typed label', () => {
  it('lookupVerifiedAddress and lookupVerifiedUrl return only the verified business name', async () => {
    mem.dests = [
      dest({ ...anchored('acme.com') }),
      dest({ kind: 'qr', rail: 'stripe', value: normalizeDestinationValue(LINK)!, proof_method: 'account_claim' }),
    ];
    expect(await lookupVerifiedAddress(WALLET)).toMatchObject({ source: 'merchant', level: 'verified', label: null });
    expect(await lookupVerifiedUrl(LINK)).toMatchObject({ source: 'merchant', label: null });
    mem.names = [businessName('Acme', 'acme.com')];
    expect(await lookupVerifiedAddress(WALLET)).toMatchObject({ label: 'Acme' });
    expect(await lookupVerifiedUrl(LINK)).toMatchObject({ label: 'Acme' });
    // The public queries do not even select the column.
    expect(mem.selects.length).toBeGreaterThan(0);
    for (const sql of mem.selects) expect(sql).not.toMatch(/\blabel\b/);
  });

  it('/api/verify/check, which shares them, carries no typed label either', async () => {
    // A typed label that would even pass the domain-derived name rule ("Jane Doe" on
    // janedoe.com) stays out unless it is the account's verified business name.
    mem.dests = [dest({ ...anchored('janedoe.com') })];
    const { body, text } = await check(WALLET);
    expect(body).toMatchObject({ status: 'proven', domain: 'janedoe.com', label: null });
    expect(text).not.toContain(TYPED);
  });
});
