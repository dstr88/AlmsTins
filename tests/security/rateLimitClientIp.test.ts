import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Public rate limits key on the Cloudflare-set client IP, never on Astro's clientAddress.
 *
 * In Astro 5 (Node adapter) clientAddress is the FIRST X-Forwarded-For value, which the
 * caller writes. /api/verify/anchor keyed on it alone, so rotating a fake header reset the
 * budget, and its counter map never evicted. /api/verify/lookup, /api/verify/check, the
 * wallet check and the activity read trusted cf-connecting-ip in production but fell back
 * to clientAddress and keyed IPv6 per address, so a client could rotate through its own
 * /64. All now use clientIpKey (cf-connecting-ip first, IPv6 grouped by /64) and bounded
 * limiters.
 *
 * No database, no network: the lookups, agent keys and the timestamp client are stubbed.
 */

vi.mock('@/lib/db', () => {
  const noDb = (): never => { throw new Error('DB-free unit test: db was called'); };
  return { db: { execute: noDb, batch: noDb } };
});
vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
  OpenTimestampsAnchor: class { stamp = vi.fn(); upgrade = vi.fn(); },
}));
vi.mock('@/lib/verifyEntities', () => ({
  lookupVerifiedAddress: async () => null,
  lookupVerifiedUrl: async () => null,
}));
vi.mock('@/lib/agentKeys', () => ({
  authenticateAgentKey: async (bearer: string) => (bearer === 'good-key' ? { id: 'key-1' } : null),
}));

import { POST as anchorPost } from '../../src/pages/api/verify/anchor';
import { GET as lookupGet } from '../../src/pages/api/verify/lookup';
import { GET as checkGet } from '../../src/pages/api/verify/check';
import { clientIpKey } from '../../src/lib/rateLimit';

const ADDR = '0x' + 'a'.repeat(40);
let fake = 0;

/** A request from `cf` (the Cloudflare-set IP) carrying a fresh forged X-Forwarded-For each time. */
function headersFrom(cf: string, extra: Record<string, string> = {}) {
  fake += 1;
  return { 'cf-connecting-ip': cf, 'x-forwarded-for': `10.9.${fake % 250}.${fake % 200}, ${cf}`, ...extra };
}
const forgedClientAddress = () => `10.8.${fake % 250}.${(fake * 7) % 250}`;

async function anchor(cf: string) {
  const request = new Request('https://almstins.com/api/verify/anchor', { method: 'POST', headers: headersFrom(cf), body: 'not json' });
  return (await (anchorPost as any)({ request, clientAddress: forgedClientAddress() })).status;
}
async function lookup(cf: string) {
  const url = new URL(`https://almstins.com/api/verify/lookup?address=${ADDR}`);
  return (await (lookupGet as any)({ request: new Request(url, { headers: headersFrom(cf) }), url, clientAddress: forgedClientAddress() })).status;
}
async function check(cf: string, extra: Record<string, string> = {}) {
  const url = new URL(`https://almstins.com/api/verify/check?value=${ADDR}`);
  return (await (checkGet as any)({ request: new Request(url, { headers: headersFrom(cf, extra) }), url, clientAddress: forgedClientAddress() })).status;
}

async function statuses(n: number, fn: () => Promise<number>) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(await fn());
  return out;
}

describe('a forged X-Forwarded-For or clientAddress never resets the budget', () => {
  it('/api/verify/anchor: 12 a minute per real client', async () => {
    const s = await statuses(13, () => anchor('198.51.100.1'));
    expect(s.slice(0, 12).every((x) => x === 400)).toBe(true); // past the limiter, then bad JSON
    expect(s[12]).toBe(429);
  });

  it('/api/verify/lookup: 30 a minute per real client', async () => {
    const s = await statuses(31, () => lookup('198.51.100.2'));
    expect(s.slice(0, 30).every((x) => x === 200)).toBe(true);
    expect(s[30]).toBe(429);
  });

  it('/api/verify/check: 30 a minute per real client without a key', async () => {
    const s = await statuses(31, () => check('198.51.100.3'));
    expect(s.slice(0, 30).every((x) => x === 200)).toBe(true);
    expect(s[30]).toBe(429);
  });
});

describe('budgets are per real client', () => {
  it('a different real IP has its own budget', async () => {
    await statuses(13, () => anchor('198.51.100.10'));
    expect(await anchor('198.51.100.11')).toBe(400);
  });

  it('IPv6 addresses in the same /64 share one budget', async () => {
    let i = 0;
    const s = await statuses(31, () => lookup(`2001:db8:1:2::${(++i).toString(16)}`));
    expect(s[30]).toBe(429);
    expect(await lookup('2001:db8:1:3::1')).toBe(200); // the next /64 is someone else
  });

  it('a valid agent key keeps its own budget after the same IP spends its anonymous one', async () => {
    await statuses(31, () => check('198.51.100.20'));
    expect(await check('198.51.100.20')).toBe(429);
    expect(await check('198.51.100.20', { authorization: 'Bearer good-key' })).toBe(200);
  });
});

describe('clientIpKey', () => {
  const key = (headers: Record<string, string>) => clientIpKey(new Request('https://almstins.com/', { headers }));

  it('trusts cf-connecting-ip over every forwarded header', () => {
    expect(key({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8' })).toBe('ip:198.51.100.7');
  });

  it('never uses the leftmost X-Forwarded-For entry', () => {
    expect(key({ 'x-forwarded-for': '1.2.3.4, 198.51.100.8' })).toBe('ip:198.51.100.8');
  });

  it('groups IPv6 by /64 and reads "unknown" with no address at all', () => {
    expect(key({ 'cf-connecting-ip': '2001:db8:aa:bb:1:2:3:4' })).toBe(key({ 'cf-connecting-ip': '2001:db8:aa:bb::ffff' }));
    expect(key({})).toBe('ip:unknown');
  });
});

describe('no API route keys a limit on clientAddress', () => {
  // wallet-check still passes clientAddress to its anonymous visit counter (as a fallback
  // when no proxy header exists); its limit uses clientIpKey. Nothing else may use it.
  const ALLOWED = new Set(['src/pages/api/wallet-check.ts']);

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = path.join(dir, name);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|js)$/.test(name) ? [p] : [];
    });
  }

  it('only the allowlisted file mentions clientAddress', () => {
    const root = path.resolve(__dirname, '../..');
    const hits = files(path.join(root, 'src/pages/api'))
      .map((f) => path.relative(root, f))
      .filter((f) => /\bclientAddress\b/.test(readFileSync(path.join(root, f), 'utf8')));
    expect(hits.filter((f) => !ALLOWED.has(f))).toEqual([]);
  });

  it('wallet-check limits on clientIpKey, not on its visit-counter ip', () => {
    const src = readFileSync(path.resolve(__dirname, '../../src/pages/api/wallet-check.ts'), 'utf8');
    expect(src).toMatch(/checkRateLimit\(clientIpKey\(request\)\)/);
  });
});
