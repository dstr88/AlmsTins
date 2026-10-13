import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GET /api/verify/check — the C5/S7b rewrite. status now comes from level first, domain
 * is always the destination's own proving domain (never the account's business name),
 * and label is dropped unless it derives from that domain. lookupVerifiedAddress /
 * lookupVerifiedUrl are mocked: this suite is about check.ts's own derivation, which
 * VerifiedAddressHit already encodes correctly (see verifyEntities.ts / claimCanonical
 * and domainAnchor tests for how a hit's level/provingDomain get set).
 */

// isValidAddress (@/lib/walletChecker) transitively imports threatLists.ts, which opens
// a real Postgres pool at module-load time (db.ts). This suite is about check.ts's own
// derivation and needs no database, so the pool never gets a chance to throw.
vi.mock('@/lib/db', () => ({ db: { execute: async () => { throw new Error('DB-free unit test: db was called'); } } }));

const entities = vi.hoisted(() => ({
  address: vi.fn<(v: string) => Promise<any>>(),
  url: vi.fn<(v: string) => Promise<any>>(),
}));
vi.mock('@/lib/verifyEntities', () => ({
  lookupVerifiedAddress: (v: string) => entities.address(v),
  lookupVerifiedUrl: (v: string) => entities.url(v),
}));
vi.mock('@/lib/agentKeys', () => ({ authenticateAgentKey: vi.fn(async () => null) }));

import { GET } from '../../src/pages/api/verify/check';

const ADDR = '0x' + 'a'.repeat(40);
const call = async (params: Record<string, string>, headers: Record<string, string> = {}) => {
  const url = new URL('https://almstins.com/api/verify/check');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await (GET as any)({ request: new Request(url, { headers }), url, clientAddress: '203.0.113.1' });
  return { res, body: await res.json() };
};

const hit = (over: Record<string, any> = {}) => ({
  source: 'merchant', level: 'verified', since: '2026-08-01', domain: 'acme.com',
  provingDomain: 'acme.com', label: null, chain: 'ethereum', ...over,
});

beforeEach(() => {
  entities.address.mockReset().mockResolvedValue(null);
  entities.url.mockReset().mockResolvedValue(null);
});

describe('status: unknown', () => {
  it('no hit at all', async () => {
    const { res, body } = await call({ value: ADDR });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: 'unknown', level: null, domain: null, label: null });
  });
});

describe('status: unanchored (replaces the old proven+claimed / mismatch+claimed)', () => {
  it('a self-send-only wallet (level claimed) never reads proven, expect or not', async () => {
    entities.address.mockResolvedValue(hit({ level: 'claimed', provingDomain: null, domain: null, since: '2026-08-01' }));
    expect((await call({ value: ADDR })).body).toMatchObject({ status: 'unanchored', level: 'claimed', domain: null });
    expect((await call({ value: ADDR, expect: 'acme.com' })).body).toMatchObject({ status: 'unanchored', domain: null });
  });

  it('a stale anchor (level dropped to claimed by the lookup itself) also reads unanchored, not proven', async () => {
    // verifyEntities.ts already degrades level to 'claimed' once an anchor goes stale
    // (merchantAddressAssurance); check.ts must not second-guess that by reading domain.
    entities.address.mockResolvedValue(hit({ level: 'claimed', domain: null, provingDomain: null }));
    expect((await call({ value: ADDR })).body.status).toBe('unanchored');
  });

  it('a payment link registered but with no verified business name reads unanchored', async () => {
    entities.url.mockResolvedValue(hit({ level: 'claimed', domain: null, provingDomain: null, chain: 'url' }));
    expect((await call({ value: 'https://buy.stripe.com/abc' })).body.status).toBe('unanchored');
  });
});

describe('status: proven / mismatch (level verified only)', () => {
  it('proven with no expect passed', async () => {
    entities.address.mockResolvedValue(hit());
    const { body } = await call({ value: ADDR });
    expect(body).toMatchObject({ status: 'proven', level: 'verified', domain: 'acme.com' });
  });

  it('proven when expect matches the proving domain exactly', async () => {
    entities.address.mockResolvedValue(hit());
    expect((await call({ value: ADDR, expect: 'acme.com' })).body.status).toBe('proven');
  });

  it('proven when the proving domain is a subdomain of expect (you pass the registrable domain; a more specific proving domain still matches)', async () => {
    entities.address.mockResolvedValue(hit({ provingDomain: 'pay.acme.com' }));
    expect((await call({ value: ADDR, expect: 'acme.com' })).body.status).toBe('proven');
  });

  it('mismatch when expect does not match the proving domain', async () => {
    entities.address.mockResolvedValue(hit({ provingDomain: 'acme.com' }));
    const { body } = await call({ value: ADDR, expect: 'notacme.com' });
    expect(body).toMatchObject({ status: 'mismatch', level: 'verified', domain: 'acme.com' });
  });

  it('mismatch in the OTHER direction: expect is more specific than what was proven (proving a parent does not vouch for a subdomain you expected)', async () => {
    entities.address.mockResolvedValue(hit({ provingDomain: 'acme.com' }));
    expect((await call({ value: ADDR, expect: 'pay.acme.com' })).body.status).toBe('mismatch');
  });
});

describe('domain: always the proving domain, never the business-name domain', () => {
  it('the C5 bug — a business-name domain that differs from the anchor must never leak into domain or match expect', async () => {
    // The account's verified business name is on a different (unrelated) domain than the
    // one that actually anchors THIS wallet (verifyEntities.ts sets `domain` to the
    // business name, `provingDomain` to the real anchor — the merchant branch of
    // lookupVerifiedAddress). Unrelated domains, not a subdomain pair, so this is purely
    // about domain/provingDomain divergence, not the subdomain-matching rule above.
    entities.address.mockResolvedValue(hit({ domain: 'acme.com', provingDomain: 'other-shop.example' }));
    const { body } = await call({ value: ADDR });
    expect(body.domain).toBe('other-shop.example');
    // An agent that (wrongly) expected the business-name domain must get mismatch, not proven.
    expect((await call({ value: ADDR, expect: 'acme.com' })).body.status).toBe('mismatch');
  });

  it('is null for an unanchored or unknown answer, even if the hit carries a display domain', async () => {
    entities.address.mockResolvedValue(hit({ level: 'claimed', domain: 'acme.com', provingDomain: null }));
    expect((await call({ value: ADDR })).body.domain).toBeNull();
  });

  it('a payment link never reports its own host as the proving domain (D6)', async () => {
    entities.url.mockResolvedValue(hit({ level: 'claimed', domain: null, provingDomain: null, chain: 'url' }));
    expect((await call({ value: 'https://buy.stripe.com/abc' })).body.domain).not.toBe('buy.stripe.com');
  });
});

describe('label: S7b — only alongside proven/mismatch, and only when it derives from domain', () => {
  it('a business name that matches the domain is shown', async () => {
    entities.address.mockResolvedValue(hit({ domain: 'joescoffee.com', provingDomain: 'joescoffee.com', label: "Joe's Coffee" }));
    expect((await call({ value: ADDR })).body.label).toBe("Joe's Coffee");
  });

  it('a freeform label that does not derive from the domain is dropped, not shown as-is', async () => {
    entities.address.mockResolvedValue(hit({ domain: 'joescoffee.com', provingDomain: 'joescoffee.com', label: 'Coinbase Support' }));
    expect((await call({ value: ADDR })).body.label).toBeNull();
  });

  it('is null on an unanchored answer even when the underlying hit carries a label', async () => {
    entities.address.mockResolvedValue(hit({ level: 'claimed', domain: null, provingDomain: null, label: 'Anything' }));
    expect((await call({ value: ADDR })).body.label).toBeNull();
  });

  it('is still shown on a mismatch, since it describes the ACTUAL business behind the destination — useful context for the human the agent hands this to', async () => {
    entities.address.mockResolvedValue(hit({ domain: 'acme.com', provingDomain: 'acme.com', label: 'Acme' }));
    expect((await call({ value: ADDR, expect: 'notacme.com' })).body).toMatchObject({ status: 'mismatch', label: 'Acme' });
  });
});

describe('entity (platform list) hits: always verified, domain === provingDomain', () => {
  it('an entity hit reads proven, and domain is the platform\'s own domain', async () => {
    entities.address.mockResolvedValue({ source: 'entity', level: 'verified', since: '2026-01-01', domain: 'exchange.example', provingDomain: 'exchange.example', label: null, chain: 'ethereum' });
    expect((await call({ value: ADDR })).body).toMatchObject({ status: 'proven', domain: 'exchange.example' });
  });
});

describe('unchanged behavior (regression guard)', () => {
  it('400s on a missing value', async () => {
    expect((await call({})).res.status).toBe(400);
  });

  it('400s when expect is not domain-shaped', async () => {
    entities.address.mockResolvedValue(hit());
    expect((await call({ value: ADDR, expect: 'not a domain' })).res.status).toBe(400);
  });

  it('503s, not 200 unknown, when the lookup throws', async () => {
    entities.address.mockRejectedValue(new Error('db down'));
    const { res, body } = await call({ value: ADDR });
    expect(res.status).toBe(503);
    expect(body.status).toBeUndefined(); // an error body, not a status payload
  });
});
