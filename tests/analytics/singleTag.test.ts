import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/**
 * One Google Analytics tag, in one component, on every page.
 *
 * The tag used to live in three places: pasted inline into Layout.astro and LoginLayout.astro,
 * and as a component dropped into the pages that render their own <head>. Copies drift (the
 * sign-up page was missed entirely) and they cannot be changed in one go. Analytics.astro is
 * now the only place the snippet exists, and every document renders it. These tests keep it so.
 */
const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const trackedAstro = execFileSync('git', ['ls-files', 'src', '*.astro'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(f => f.endsWith('.astro'));
const code = (text: string) => text.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

describe('the snippet exists once', () => {
  it('only Analytics.astro loads gtag.js or calls gtag("config")', () => {
    const holders = trackedAstro.filter(f => {
      const text = code(read(f));
      return /googletagmanager\.com\/gtag\/js/.test(text) || /gtag\(\s*['"]config['"]/.test(text);
    });
    expect(holders).toEqual(['src/components/Analytics.astro']);
  });

  it('only Analytics.astro includes the page-context script', () => {
    const includers = trackedAstro.filter(
      f => f !== 'src/components/AnalyticsPageContext.astro' && /<AnalyticsPageContext/.test(read(f)),
    );
    expect(includers).toEqual(['src/components/Analytics.astro']);
  });

  it('the two layouts use the component instead of their own copy', () => {
    for (const f of ['src/layouts/Layout.astro', 'src/layouts/LoginLayout.astro']) {
      const text = read(f);
      expect(text, f).toMatch(/import Analytics from ["']@\/components\/Analytics\.astro["']/);
      expect(text, f).toMatch(/<Analytics\b/);
    }
  });

  it('no page renders both a layout that carries the tag and its own <Analytics />', () => {
    const doubled = trackedAstro.filter(f => {
      const text = read(f);
      return /<Analytics\b/.test(text) && /<(Layout|LoginLayout|PetroTinsLayout|PetroTinsLegalLayout)\b/.test(text);
    });
    expect(doubled).toEqual([]);
  });
});

describe('every document that renders its own <html> carries the tag', () => {
  // A deliberate exception needs a reason written here, so it is a decision and not an accident.
  const EXEMPT: Record<string, string> = {
    'src/pages/verify-email.astro':
      'the sign-up confirmation link carries a token; the page says "no analytics" on purpose',
    'src/pages/dashboard/yearEnd/report.astro':
      'its <html> is the downloadable export built as a string; the page itself renders through Layout',
  };

  it('has a tag, or a written reason not to', () => {
    const missing = trackedAstro.filter(f => {
      const text = read(f);
      return /^\s*<html\b/m.test(text) && !/<Analytics\b/.test(text) && !(f in EXEMPT);
    });
    expect(missing).toEqual([]);
  });

  it('the sign-up page, which never had the tag, has it now', () => {
    expect(read('src/components/SignupPage.astro')).toMatch(/<Analytics\b/);
  });
});

describe('the tag script itself', () => {
  // Read lazily, so a changed script shape fails these tests with a message instead of crashing
  // the whole file and hiding the structural checks above.
  function tagScript(): string {
    const m = read('src/components/Analytics.astro').match(
      /<script is:inline define:vars=\{\{[^}]*\}\}>([\s\S]*?)<\/script>/,
    );
    if (!m) throw new Error('Analytics.astro has no <script is:inline define:vars={{ … }}> block; update this test if the shape changed on purpose');
    return m[1];
  }

  /** Runs the snippet the way a browser does, with Astro's define:vars prepended. */
  function run(vars: { GA_ID: string; demo: boolean }, gaPage: Record<string, string> | undefined, pathname = '/verify') {
    const sandbox: any = { location: { pathname }, Date, Object };
    sandbox.window = sandbox; // a browser's window is the global object
    if (gaPage) sandbox.__gaPage = gaPage;
    vm.createContext(sandbox);
    vm.runInContext(
      `const GA_ID = ${JSON.stringify(vars.GA_ID)}; const demo = ${vars.demo};\n${tagScript()}`,
      sandbox,
    );
    return (sandbox.dataLayer as any[]).map(a => Array.from(a));
  }

  it('configures the property with the page context and nothing else', () => {
    const calls = run({ GA_ID: 'G-TEST', demo: false }, { page_location: 'https://almstins.com/verify', traffic_type: 'internal' });
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe('js');
    expect(calls[1]).toEqual(['config', 'G-TEST', { page_location: 'https://almstins.com/verify', traffic_type: 'internal' }]);
  });

  it('still configures when the page context is missing', () => {
    expect(run({ GA_ID: 'G-TEST', demo: false }, undefined)[1]).toEqual(['config', 'G-TEST', {}]);
  });

  it('reports a demo visitor under /demo, flags them, and sends the demo pageview', () => {
    const calls = run({ GA_ID: 'G-TEST', demo: true }, { page_location: 'https://almstins.com/dashboard/vault' }, '/dashboard/vault');
    expect(calls[1]).toEqual(['config', 'G-TEST', { page_location: 'https://almstins.com/dashboard/vault', page_path: '/demo/dashboard/vault' }]);
    expect(calls[2]).toEqual(['set', 'user_properties', { demo_user: 'true' }]);
    expect(calls[3]).toEqual(['event', 'demo_page_view', { event_category: 'demo', event_label: '/dashboard/vault' }]);
  });

  it('sends no demo events for a normal visitor', () => {
    expect(run({ GA_ID: 'G-TEST', demo: false }, {}).map(c => c[0])).toEqual(['js', 'config']);
  });
});
