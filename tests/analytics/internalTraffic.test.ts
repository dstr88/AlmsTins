import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/**
 * The inline script in AnalyticsPageContext.astro decides what GA4 may learn about a page. It
 * runs in every browser before gtag('config'), on all three tag paths (Analytics.astro,
 * Layout.astro, LoginLayout.astro). These tests run the real script text in a sandbox standing
 * in for the browser, so what is tested is exactly what ships.
 *
 * Four jobs: (1) keep the privacy allowlist (origin + path and utm_* only); (2) mark
 * the owner's own traffic traffic_type "internal" so GA4's built-in Internal Traffic filter can
 * drop it: automated browsers (the scheduled Playwright runs), a local dev server, a browser
 * flagged once with ?internal=1, and any device the owner is signed in on; (3) count sign-outs
 * without saying who; (4) decide, once per device, that a brand-new account's visit is a sign-up.
 */
const source = readFileSync(
  path.resolve(__dirname, '../../src/components/AnalyticsPageContext.astro'),
  'utf8',
);
const script = source.match(/<script is:inline>([\s\S]*?)<\/script>/)![1];

type Options = {
  url?: string;
  webdriver?: boolean;
  referrer?: string;
  /** Pre-existing localStorage contents, or 'blocked' when storage throws. */
  storage?: Record<string, string> | 'blocked';
  /** What Analytics.astro puts in window.__gaSession for a dashboard page. */
  session?: { owner?: boolean; newAccount?: string | null };
};

function load(options: Options = {}) {
  const url = new URL(options.url ?? 'https://almstins.com/login');
  const blocked = options.storage === 'blocked';
  const store: Record<string, string> = options.storage && !blocked ? { ...options.storage } : {};
  const handlers: Record<string, Array<(e: any) => void>> = { click: [], submit: [] };
  const window: any = options.session ? { __gaSession: options.session } : {};
  const sandbox: any = {
    window,
    location: { origin: url.origin, pathname: url.pathname, href: url.href, hostname: url.hostname },
    document: {
      referrer: options.referrer ?? '',
      addEventListener: (type: string, fn: (e: any) => void) => handlers[type]?.push(fn),
    },
    navigator: { webdriver: options.webdriver === true },
    localStorage: blocked
      ? {
          getItem() { throw new Error('storage blocked'); },
          setItem() { throw new Error('storage blocked'); },
          removeItem() { throw new Error('storage blocked'); },
        }
      : {
          getItem: (k: string) => (k in store ? store[k] : null),
          setItem: (k: string, v: string) => { store[k] = String(v); },
          removeItem: (k: string) => { delete store[k]; },
        },
    URL,
    URLSearchParams,
  };
  vm.runInNewContext(script, sandbox);
  return {
    page: window.__gaPage as Record<string, string>,
    store,
    /** Whether Analytics.astro will send sign_up after gtag('config'). */
    signUp: window.__gaSignUp === true,
    /** Everything pushed onto dataLayer, each call as a plain array. */
    sent: () => ((window.dataLayer ?? []) as any[]).map(a => Array.from(a)),
    clickLink: (href: string | null) =>
      handlers.click.forEach(fn => fn({ target: { closest: () => (href === null ? null : { href }) } })),
    submitForm: (action: string) => handlers.submit.forEach(fn => fn({ target: { action } })),
  };
}

describe('what GA may learn about a page (the privacy allowlist stays)', () => {
  it('keeps origin and path, and only utm_* from the query (gclid is dropped)', () => {
    const { page } = load({ url: 'https://almstins.com/verify/desk?token=SECRET&id=abc&utm_source=linkedin&gclid=g1&next=%2Fx' });
    expect(page.page_location).toBe('https://almstins.com/verify/desk?utm_source=linkedin');
  });

  it('strips the query and fragment from the referrer', () => {
    const { page } = load({ referrer: 'https://www.google.com/search?q=secret#frag' });
    expect(page.page_referrer).toBe('https://www.google.com/search');
  });

  it('marks an ordinary visitor as nothing special', () => {
    expect(load().page.traffic_type).toBeUndefined();
    expect(load({ url: 'https://ledgerlense-production.onrender.com/' }).page.traffic_type).toBeUndefined();
  });
});

describe('internal traffic is marked so GA4 can filter it', () => {
  it('marks an automated browser (the scheduled test runs)', () => {
    expect(load({ webdriver: true }).page.traffic_type).toBe('internal');
  });

  it.each([
    'http://localhost:4321/',
    'http://127.0.0.1:4321/dashboard',
    'http://app.localhost:4321/',
  ])('marks a local dev server: %s', url => {
    expect(load({ url }).page.traffic_type).toBe('internal');
  });

  it('marks a browser flagged once with ?internal=1, and keeps marking it without the parameter', () => {
    const first = load({ url: 'https://almstins.com/?internal=1' });
    expect(first.page.traffic_type).toBe('internal');
    expect(first.store.almstins_internal).toBe('1');
    const later = load({ url: 'https://almstins.com/wallet-checker', storage: first.store });
    expect(later.page.traffic_type).toBe('internal');
  });

  it('never sends the flag parameter to GA', () => {
    const { page } = load({ url: 'https://almstins.com/?internal=1&utm_source=x' });
    expect(page.page_location).toBe('https://almstins.com/?utm_source=x');
    expect(JSON.stringify(page)).not.toContain('internal=');
  });

  it('clears the flag with ?internal=0', () => {
    const flagged = load({ url: 'https://almstins.com/?internal=1' });
    const cleared = load({ url: 'https://almstins.com/?internal=0', storage: flagged.store });
    expect(cleared.page.traffic_type).toBeUndefined();
    expect(cleared.store.almstins_internal).toBeUndefined();
  });

  it('survives blocked storage: a visitor is untouched and an automated browser is still marked', () => {
    expect(load({ storage: 'blocked' }).page.traffic_type).toBeUndefined();
    expect(load({ storage: 'blocked' }).page.page_location).toBe('https://almstins.com/login');
    expect(load({ storage: 'blocked', webdriver: true }).page.traffic_type).toBe('internal');
  });
});

describe('sign-outs are counted, never attributed', () => {
  const SIGN_OUT = ['event', 'sign_out', { transport_type: 'beacon' }];

  it('counts a click on the Auth.js sign-out link (Verify menu, login popup)', () => {
    const p = load();
    p.clickLink('https://almstins.com/api/auth/signout?callbackUrl=%2Fverify');
    expect(p.sent()).toEqual([SIGN_OUT]);
  });

  it('counts a click on a link to the custom /api/logout, trailing slash or not', () => {
    const p = load();
    p.clickLink('https://almstins.com/api/logout');
    p.clickLink('https://almstins.com/api/logout/');
    expect(p.sent()).toEqual([SIGN_OUT, SIGN_OUT]);
  });

  it('counts the dashboard logout form posting to /api/logout', () => {
    const p = load();
    p.submitForm('https://almstins.com/api/logout');
    expect(p.sent()).toEqual([SIGN_OUT]);
  });

  it('ignores every other link, form and click', () => {
    const p = load();
    p.clickLink('https://almstins.com/wallet-checker');
    p.clickLink('https://almstins.com/api/auth/session');
    p.clickLink(null);
    p.submitForm('https://almstins.com/api/petro-tins/splits');
    expect(p.sent()).toEqual([]);
  });

  it('carries nothing about who: the event has a transport hint and no other field', () => {
    const p = load();
    p.clickLink('https://almstins.com/api/logout');
    const [, , params] = p.sent()[0];
    expect(Object.keys(params)).toEqual(['transport_type']);
  });
});

describe('the signed-in owner flags the device', () => {
  it('marks the page internal and remembers the device, so later public pages stay internal', () => {
    const dashboard = load({ url: 'https://almstins.com/dashboard/vault', session: { owner: true } });
    expect(dashboard.page.traffic_type).toBe('internal');
    expect(dashboard.store.almstins_internal).toBe('1');
    const later = load({ url: 'https://almstins.com/wallet-checker', storage: dashboard.store });
    expect(later.page.traffic_type).toBe('internal');
  });

  it('still marks the page when storage is blocked', () => {
    expect(load({ storage: 'blocked', session: { owner: true } }).page.traffic_type).toBe('internal');
  });

  it('leaves a signed-in customer alone', () => {
    const p = load({ url: 'https://almstins.com/dashboard/vault', session: { owner: false } });
    expect(p.page.traffic_type).toBeUndefined();
    expect(p.store.almstins_internal).toBeUndefined();
  });
});

describe('a new account is counted once, never attributed', () => {
  const KEY = '2026-10-08 14:55:00';

  it('decides to send sign_up on the first page of a new account', () => {
    const p = load({ url: 'https://almstins.com/dashboard/vault', session: { newAccount: KEY } });
    expect(p.signUp).toBe(true);
    expect(p.store.almstins_signup_counted).toBe(KEY);
  });

  it('does not count the same account again on the next page', () => {
    const first = load({ session: { newAccount: KEY } });
    const second = load({ storage: first.store, session: { newAccount: KEY } });
    expect(second.signUp).toBe(false);
  });

  it('counts a different new account on the same device', () => {
    const first = load({ session: { newAccount: KEY } });
    expect(load({ storage: first.store, session: { newAccount: '2026-10-09 08:00:00' } }).signUp).toBe(true);
  });

  it('sends nothing when storage is blocked, rather than counting every page', () => {
    expect(load({ storage: 'blocked', session: { newAccount: KEY } }).signUp).toBe(false);
  });

  it('sends nothing without a new account, and never puts the timestamp in the page context', () => {
    expect(load().signUp).toBe(false);
    expect(load({ session: { newAccount: null } }).signUp).toBe(false);
    const p = load({ session: { newAccount: KEY } });
    expect(JSON.stringify(p.page)).not.toContain(KEY);
    expect(p.sent()).toEqual([]);
  });
});
