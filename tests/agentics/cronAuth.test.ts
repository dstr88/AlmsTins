import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * How the Vault's two scheduled endpoints compare the secret they are called with: both sides
 * hashed, then crypto.timingSafeEqual, so the time taken says nothing about how much of the secret
 * a caller has right; and closed when no secret is configured. node:crypto's timingSafeEqual is
 * wrapped here so the tests can see what it was handed. Every secret here is invented.
 */
const spy = vi.hoisted(() => ({ calls: [] as Array<[Buffer, Buffer]> }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    default: actual,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      spy.calls.push([Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)]);
      return actual.timingSafeEqual(a, b);
    },
  };
});

let auth: typeof import('../../src/lib/agentVault/cronAuth');
const SECRET = 'cron-secret-canary-4d19';

beforeEach(async () => {
  spy.calls = [];
  vi.resetModules();
  auth = await import('../../src/lib/agentVault/cronAuth');
});

describe('a secret that matches', () => {
  it('is let in', () => {
    expect(auth.cronSecretMatches(SECRET, SECRET)).toBe(true);
    expect(auth.cronSecretMatches('a', 'a')).toBe(true);
    expect(auth.cronSecretMatches('é中 secret with spaces', 'é中 secret with spaces')).toBe(true);
  });
});

describe('a secret that does not match', () => {
  it.each([
    ['another secret', 'cron-secret-canary-0000'],
    ['the same with a different case', SECRET.toUpperCase()],
    ['a prefix of it', SECRET.slice(0, -1)],
    ['it with one more byte', `${SECRET}x`],
    ['it with a trailing space', `${SECRET} `],
    ['a much longer one that starts with it', `${SECRET}${'x'.repeat(5000)}`],
    ['a single byte', 'c'],
    ['a differing last byte', `${SECRET.slice(0, -1)}e`],
    ['a differing first byte', `x${SECRET.slice(1)}`],
  ])('is refused: %s', (_name, provided) => {
    expect(auth.cronSecretMatches(SECRET, provided)).toBe(false);
  });

  it('never throws for a secret of any length (timingSafeEqual itself throws on buffers of different lengths)', () => {
    for (const provided of ['', 'x', SECRET, `${SECRET}${SECRET}`, 'y'.repeat(100_000)]) expect(() => auth.cronSecretMatches(SECRET, provided)).not.toThrow();
  });
});

describe('closed when nothing is configured', () => {
  it.each([[undefined], [null], [''], [0], [false], [{}], [['x']]])('a configured secret of %j matches nothing, not even what a caller might send', (configured) => {
    for (const provided of [undefined, null, '', 'x', String(configured), SECRET, 'undefined', 'null']) {
      expect(auth.cronSecretMatches(configured, provided), `${String(configured)} / ${String(provided)}`).toBe(false);
    }
    expect(spy.calls).toEqual([]); // nothing was even compared
  });

  it('a caller who sends nothing, or a header that is empty, is refused even against a real secret', () => {
    for (const provided of [undefined, null, '', 0, false, {}, ['x']]) expect(auth.cronSecretMatches(SECRET, provided)).toBe(false);
  });

  it('empty against empty is not a match', () => {
    expect(auth.cronSecretMatches('', '')).toBe(false);
  });
});

describe('the comparison is constant time', () => {
  it('goes through crypto.timingSafeEqual, with two 32-byte digests, whatever was sent', () => {
    for (const provided of [SECRET, 'x', SECRET.slice(0, -1), `${SECRET}${'x'.repeat(5000)}`, 'y'.repeat(100_000)]) auth.cronSecretMatches(SECRET, provided);
    expect(spy.calls).toHaveLength(5);
    for (const [a, b] of spy.calls) {
      expect(a).toHaveLength(32);
      expect(b).toHaveLength(32);
    }
  });

  it('compares digests, never the secret itself: the bytes handed over contain neither value', () => {
    auth.cronSecretMatches(SECRET, `${SECRET}!`);
    const [[a, b]] = spy.calls;
    expect(a.toString('utf8')).not.toContain(SECRET);
    expect(b.toString('utf8')).not.toContain(SECRET);
    expect(a.equals(b)).toBe(false);
  });

  it('is not compared with a plain equality anywhere in the two routes or this helper', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const root = resolve(__dirname, '../..');
    for (const file of ['src/lib/agentVault/cronAuth.ts', 'src/pages/api/cron/agent-reports.ts', 'src/pages/api/cron/sync-agent-wallets.ts']) {
      const src = readFileSync(resolve(root, file), 'utf8');
      expect(src, file).not.toMatch(/provided\s*[!=]==?\s*secret|secret\s*[!=]==?\s*provided|configured\s*[!=]==?\s*provided/);
    }
  });

  it('logs nothing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    auth.cronSecretMatches(SECRET, 'nope');
    auth.cronSecretMatches('', 'nope');
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
