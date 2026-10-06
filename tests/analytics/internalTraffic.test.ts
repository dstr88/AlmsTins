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
 * Three jobs: (1) keep the privacy allowlist (origin + path, utm_* and gclid only); (2) mark
 * the owner's own traffic traffic_type "internal" so GA4's built-in Internal Traffic filter can
 * drop it: automated browsers (the scheduled Playwright runs), a local dev server, and a
 * browser flagged once with ?internal=1; (3) count sign-outs without saying who.
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
};

function load(options: Options = {}) {
  const url = new URL(options.url ?? 'https://almstins.com/login');
  const blocked = options.storage === 'blocked';
  const store: Record<string, string> = options.storage && !blocked ? { ...options.storage } : {};
  const handlers: Record<string, Array<(e: any) => void>> = { click: [], submit: [] };
  const window: any = {};
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
    /** Everything pushed onto dataLayer, each call as a plain array. */
    sent: () => ((window.dataLayer ?? []) as any[]).map(a => Array.from(a)),
    clickLink: (href: string | null) =>
      handlers.click.forEach(fn => fn({ target: { closest: () => (href === null ? null : { href }) } })),
    submitForm: (action: string) => handlers.submit.forEach(fn => fn({ target: { action } })),
  };
}

describe('what GA may learn about a page (the privacy allowlist stays)', () => {
  it('keeps origin and path, and only utm_* and gclid from the query', () => {
    const { page } = load({ url: 'https://almstins.com/verify/desk?token=SECRET&id=abc&utm_source=linkedin&gclid=g1&next=%2Fx' });
    expect(page.page_location).toBe('https://almstins.com/verify/desk?utm_source=linkedin&gclid=g1');
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
