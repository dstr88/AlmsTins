import { describe, it, expect } from 'vitest';
import { routeLegacy, financingNext, PAIRS } from '../../src/middleware/legacyRedirects';

const u = (pathAndQuery: string) => new URL(pathAndQuery, 'https://almstins.com');
const MOVED = ['registry', 'desk', 'client', 'confirm', 'invite', 'offer', 'countersign', 'attest',
  'authenticate', 'runsheet', 'guide', 'changelog', 'thanks'];

describe('PAIRS', () => {
  // Links already in inboxes, on printed run sheets and in chat threads depend on every pair.
  it('never loses a pair', () => {
    expect(PAIRS).toEqual([
      ...MOVED.map((p) => [`/verify/${p}`, `/receivables/${p}`]),
      ['/verify/cairn', '/receivables/milestones'],
      ['/verify/cairn-attest', '/receivables/milestone-check'],
      ['/artifacts/cairn', '/receivables/milestones-demo'],
    ]);
  });
});

describe('alias phase (today)', () => {
  it('serves every /receivables/<name> from its /verify page, with or without a trailing slash', () => {
    for (const p of MOVED) {
      expect(routeLegacy(u(`/receivables/${p}`), 'alias')).toEqual({ kind: 'rewrite', to: `/verify/${p}` });
      expect(routeLegacy(u(`/receivables/${p}/`), 'alias')).toEqual({ kind: 'rewrite', to: `/verify/${p}` });
    }
    // A bare /receivables/login keeps the role-neutral Receivables sign-in.
    expect(routeLegacy(u('/receivables/login'), 'alias')).toEqual({ kind: 'rewrite', to: '/verify/login?next=%2Freceivables' });
    expect(routeLegacy(u('/receivables/login?role=client'), 'alias')).toEqual({ kind: 'rewrite', to: '/verify/login?next=%2Freceivables&role=client' });
  });

  it('keeps the query string byte for byte (tokens, ids, duplicates, encoding)', () => {
    expect(routeLegacy(u('/receivables/attest?token=abc_DEF-1&t=abc_DEF-1'), 'alias'))
      .toEqual({ kind: 'rewrite', to: '/verify/attest?token=abc_DEF-1&t=abc_DEF-1' });
    expect(routeLegacy(u('/receivables/desk?id=INV%2F4471&id=2&utm_source=x'), 'alias'))
      .toEqual({ kind: 'rewrite', to: '/verify/desk?id=INV%2F4471&id=2&utm_source=x' });
    expect(routeLegacy(u('/receivables/login?next=%2Freceivables%2Fdesk'), 'alias'))
      .toEqual({ kind: 'rewrite', to: '/verify/login?next=%2Freceivables%2Fdesk' });
  });

  it('leaves /verify, the landing, and everything else alone', () => {
    for (const p of [
      '/verify/desk', '/verify/attest?token=x', '/verify/login', '/verify/scan?address=0xabc', '/verify',
      '/verify/es', '/verify/agents', '/verify/agent-keys', '/verify-record', '/receivables', '/receivables/',
      '/receivables/unknown', '/receivables/milestones-demo', '/artifacts/cairn', '/artifacts/cairn/',
      // The private milestone pages have no alias yet (they answer like any unknown name).
      '/receivables/milestones', '/receivables/milestone-check?token=x',
      '/dashboard/verify', '/',
    ]) {
      expect(routeLegacy(u(p), 'alias'), p).toBeNull();
    }
  });

  it('matches exact names only, case-sensitive', () => {
    expect(routeLegacy(u('/receivables/desks'), 'alias')).toBeNull();
    expect(routeLegacy(u('/receivables/Desk'), 'alias')).toBeNull();
    expect(routeLegacy(u('/receivables/desk/extra'), 'alias')).toBeNull();
    expect(routeLegacy(u('/receivables/milestone-checks'), 'alias')).toBeNull();
  });
});

describe('later phases (built now, switched on later)', () => {
  it('rewrite: old /verify paths are served from /receivables', () => {
    expect(routeLegacy(u('/verify/offer?token=t'), 'rewrite')).toEqual({ kind: 'rewrite', to: '/receivables/offer?token=t' });
    expect(routeLegacy(u('/verify/cairn-attest?token=t'), 'rewrite')).toEqual({ kind: 'rewrite', to: '/receivables/milestone-check?token=t' });
    expect(routeLegacy(u('/verify/cairn'), 'rewrite')).toEqual({ kind: 'rewrite', to: '/receivables/milestones' });
    expect(routeLegacy(u('/verify/scan'), 'rewrite')).toBeNull();
    expect(routeLegacy(u('/verify/login'), 'rewrite')).toBeNull();
  });

  it('redirect: 308 with no-store, query kept, never indexed', () => {
    const a = routeLegacy(u('/verify/confirm?token=abc&x=1'), 'redirect');
    expect(a?.kind).toBe('respond');
    const r = (a as { kind: 'respond'; response: Response }).response;
    expect(r.status).toBe(308);
    expect(r.headers.get('Location')).toBe('/receivables/confirm?token=abc&x=1');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(r.headers.get('X-Robots-Tag')).toBe('noindex');
  });

  it('login forwarder (off today) sends financing sign-ins to /receivables/login with a safe next', () => {
    expect(routeLegacy(u('/verify/login?next=/verify/desk'), 'redirect', false)).toBeNull();
    const a = routeLegacy(u('/verify/login?next=/verify/desk&role=financier'), 'redirect', true);
    const r = (a as { kind: 'respond'; response: Response }).response;
    expect(r.status).toBe(307);
    expect(r.headers.get('Location')).toBe('/receivables/login?next=%2Freceivables%2Fdesk&role=financier');
    expect(routeLegacy(u('/verify/login?next=/dashboard/verify'), 'redirect', true)).toBeNull();
    expect(routeLegacy(u('/verify/login?next=//evil.com'), 'redirect', true)).toBeNull();
  });
});

describe('financingNext', () => {
  it('maps old financing paths, keeps /receivables ones, refuses everything else', () => {
    expect(financingNext('/verify/invite?token=abc')).toBe('/receivables/invite?token=abc');
    expect(financingNext('/verify/cairn')).toBe('/receivables/milestones');
    expect(financingNext('/receivables/client')).toBe('/receivables/client');
    expect(financingNext('/receivables')).toBe('/receivables');
    expect(financingNext('/receivables/login')).toBeNull();
    expect(financingNext('/dashboard/verify')).toBeNull();
    expect(financingNext('/\\evil.com')).toBeNull();
    expect(financingNext(null)).toBeNull();
  });
});
