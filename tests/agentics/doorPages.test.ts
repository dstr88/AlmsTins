import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The three Agentics door pages, read as source: what each one links to, what it posts to, who it
 * lets in, and what it never does. (tests/agentics/doorCopy.test.ts covers the words and the colors;
 * the built server is exercised by hand for the real redirects and the rendered output.)
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const landing = read('src/pages/agentics/index.astro');
const login = read('src/pages/agentics/login.astro');
const welcome = read('src/pages/dashboard/agentics/index.astro');
const docs = read('src/pages/agentics/docs.astro');

/** A page's code without its comments (the headers name functions to say they are NOT called here). */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the landing page /agentics', () => {
  it('is public and indexable, with its own canonical address and the usual SEO tags', () => {
    expect(landing).not.toMatch(/name="robots"/);
    expect(landing).toContain("const canonical = 'https://almstins.com/agentics';");
    expect(landing).toContain('<link rel="canonical" href={canonical} />');
    for (const tag of ['<title>{l.title}</title>', 'name="description"', 'property="og:title"', 'property="og:url"', 'property="og:image"', 'name="twitter:card"']) {
      expect(landing, tag).toContain(tag);
    }
    expect(landing).toMatch(/export const prerender = false;/);
  });

  it('is its own document: it does not use the layout that ends in the crypto tracker footer', () => {
    expect(code(landing)).not.toMatch(/LoginLayout|components\/Footer|<Footer/);
    expect(landing).toContain("import Analytics from '@/components/Analytics.astro';");
  });

  it('sends the sign-up button to the Agentics sign-in, carrying the campaign label, and the docs button to /agentics/docs', () => {
    expect(landing).toContain("import { cleanSource, signupHref } from '@/lib/agenticsSource';");
    expect(landing).toMatch(/signupHref\(cleanSource\(Astro\.url\.searchParams\.get\('src'\)\)\)/);
    expect(landing).toContain('href={signup}');
    expect(landing).toContain('href="/agentics/docs"');
  });

  it('has one heading level one, no form, no script and no raw html', () => {
    expect((landing.match(/<h1/g) ?? []).length).toBe(1);
    expect(code(landing)).not.toMatch(/<form|<script|set:html|innerHTML/);
  });

  it('links only to pages on this site', () => {
    const hrefs = [...landing.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.sort()).toEqual(['/agentics/docs', '/agentics/docs', '/privacy', '/wallet-checker']);
    expect(code(landing)).not.toMatch(/href="https?:/);
  });

  it('reads its words from the copy module, not from literals of its own', () => {
    expect(landing).toContain("import { en as t } from '@/i18n/agentics';");
    expect(landing).not.toMatch(/Create a free account|Check the address before/);
  });
});

describe('the sign-in /agentics/login', () => {
  it('posts to the same Auth.js endpoints as the other sign-in pages', () => {
    for (const action of ['/api/auth/signin/google', '/api/auth/signin/github', '/api/auth/signin/email', '/api/auth/callback/credentials']) {
      expect(login).toContain(`action="${action}"`);
    }
  });

  it('refreshes the CSRF token in the browser and keeps the buttons off until it lands', () => {
    expect(login).toContain("fetch('/api/auth/csrf'");
    expect((login.match(/data-needs-csrf disabled/g) ?? []).length).toBe(4);
    expect((login.match(/<input type="hidden" name="csrfToken"/g) ?? []).length).toBe(4);
  });

  it('lands on the Agentics welcome page when there is no destination, and goes straight there when already signed in', () => {
    expect(login).toContain("const callbackUrl = hasDestination ? data.safeCallbackUrl : '/dashboard/agentics';");
    expect(login).toContain('if (data.isLoggedIn) return Astro.redirect(callbackUrl, 302);');
  });

  it('is never indexed, and creates nothing itself: the first sign-in makes the account', () => {
    expect(login).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(login).toMatch(/There is no separate signup/);
    expect(code(login)).not.toMatch(/ensureTenantForUser|INSERT INTO|db\.execute/);
    expect(code(login)).not.toMatch(/set:html|innerHTML/);
  });
});

describe('the welcome page /dashboard/agentics', () => {
  it('needs a real session: signed out and demo visitors are sent to the Agentics sign-in', () => {
    expect(welcome).toContain('const session = await requireTenantSession(Astro.request);');
    expect(welcome).toContain("if (!session || session.isDemo) return Astro.redirect('/agentics/login?next=%2Fdashboard%2Fagentics', 303);");
  });

  it('is never cached or indexed', () => {
    expect(welcome).toContain("Astro.response.headers.set('Cache-Control', 'private, no-store');");
    expect(welcome).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it('signs out through the one logout component, and lands back on the Agentics page', () => {
    expect(welcome).toContain("import LogoutButton from '@/components/LogoutButton.astro';");
    expect(welcome).toMatch(/<LogoutButton[^>]*next="\/agentics"/);
    expect(welcome).not.toContain('/api/logout');
  });

  it('sends the letter through the once-only claim, and never holds the page for more than a few seconds', () => {
    expect(welcome).toContain("import { welcomeOnFirstVisit } from '@/lib/agenticsSignup';");
    expect(welcome).toContain('const SEND_WAIT_MS = 4000;');
    expect(welcome).toMatch(/Promise\.race\(/);
    expect(welcome).toMatch(/outcome === 'sent' &&/);
  });

  it('takes the address from the signed-in session, never from the request', () => {
    expect(welcome).toContain('email: auth?.user?.email ?? null');
    expect(welcome).not.toMatch(/searchParams\.get\('(email|tenant|tenantId)'\)/);
  });

  it('creates no tenant and uses no raw html', () => {
    expect(code(welcome)).not.toMatch(/ensureTenantForUser|INSERT INTO|db\.execute|set:html|innerHTML/);
  });

  it('shows the letter, the lines under it, and nothing from the Almstins vault navigation', () => {
    expect(welcome).toContain('letter.paragraphs.map');
    expect(welcome).not.toMatch(/\/dashboard\/vault|\/dashboard\/portfolio|NetWorthHero|layouts\/Layout/);
  });
});

describe('the middleware', () => {
  const app = read('src/middleware/app.ts');

  it('sends a signed-out visitor of /dashboard/agentics to the Agentics sign-in, ahead of the general /login', () => {
    const agentics = app.indexOf("pathname === '/dashboard/agentics' || pathname.startsWith('/dashboard/agentics/')");
    const general = app.indexOf("const loginPath = ");
    expect(agentics).toBeGreaterThan(0);
    expect(general).toBeGreaterThan(agentics);
    expect(app.slice(agentics, general)).toContain('/agentics/login?next=${next}');
  });

  it('opens no door of its own: the Agentics paths are public only as the exact paths in isPublicPath', () => {
    const auth = read('src/middleware/auth.ts');
    expect(auth).not.toMatch(/startsWith\('\/agentics/);
    expect(auth).not.toMatch(/startsWith\('\/dashboard\/agentics/);
  });
});

describe('the docs moved, and are still the same page', () => {
  it('lives at src/pages/agentics/docs.astro and is served per request', () => {
    expect(docs).toMatch(/export const prerender = false;/);
    expect(docs).toContain("import ApiDocsLayout from '@/layouts/ApiDocsLayout.astro';");
  });

  it('the old location is gone, so /agentics is the landing and never the docs', () => {
    expect(() => read('src/pages/agentics.astro')).toThrow();
  });
});
