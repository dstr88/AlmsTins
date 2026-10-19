import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { canAccessAgenticsVault, isAgenticsDoorPath, isAgenticsVaultPath } from '../../src/lib/agenticsAccess';
import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { DEMO_TENANT_ID } from '../../src/lib/demo';

/**
 * /dashboard/agentics is one address with two pages: the Agent Vault's home for an account that may
 * use the Vault, and the free-signup door's welcome letter for every other account. The letter has to
 * stay what it has always been (one email, a sign-in redirect for a demo session, never cached or
 * indexed, nothing of the Vault read, and not a byte different), so this pins both branches and the
 * letter itself.
 *
 * The page stays the letter page. An account that may use the Vault is handed to the agents page
 * (src/pages/dashboard/agentics/agents.astro) by a rewrite before any of the letter's work begins, so
 * the address does not change and the letter's page imports nothing of the Vault: it loads none of the
 * Vault's styles (an Astro page carries the CSS of everything it imports, rendered or not) and none of
 * its code. The page is an Astro file, and Astro 5 cannot render under this suite's Vite, so the split
 * is pinned as source (the way doorPages.test.ts pins the other door pages); the built server is
 * exercised by hand for the rendered output of each branch, compared byte for byte with production's.
 */
const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const page = read('src/pages/dashboard/agentics/index.astro');
const agents = read('src/pages/dashboard/agentics/agents.astro');

/** A page's code without its comments (the headers name things to say they are NOT done here). */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
/** The part of a page between its frontmatter fences. */
const frontmatter = (src: string): string => src.split('---')[1] ?? '';

describe('who gets which page: the decision the home page makes', () => {
  const OTHER = '00000000-0000-4000-8000-000000000002';

  it('the Vault is for the owner while it is private, and for no one else', () => {
    expect(canAccessAgenticsVault({ tenantId: OWNER_TENANT_ID })).toBe(true);
    expect(canAccessAgenticsVault({ tenantId: OTHER })).toBe(false);
    expect(canAccessAgenticsVault({ tenantId: DEMO_TENANT_ID, isDemo: true })).toBe(false);
    expect(canAccessAgenticsVault({ tenantId: OWNER_TENANT_ID, isDemo: true })).toBe(false);
    expect(canAccessAgenticsVault({ tenantId: null })).toBe(false);
    expect(canAccessAgenticsVault(null)).toBe(false);
  });

  it('once the Vault is open it is for every real account, and still not for a demo session or a visitor with no tenant', () => {
    expect(canAccessAgenticsVault({ tenantId: OTHER }, true)).toBe(true);
    expect(canAccessAgenticsVault({ tenantId: DEMO_TENANT_ID, isDemo: true }, true)).toBe(false);
    expect(canAccessAgenticsVault({ tenantId: '' }, true)).toBe(false);
    expect(canAccessAgenticsVault(null, true)).toBe(false);
  });

  it('the address the letter lives at is open to every account, and the agents page it hands the Vault viewer to is gated like the rest of the Vault', () => {
    expect(isAgenticsDoorPath('/dashboard/agentics')).toBe(true);
    expect(isAgenticsVaultPath('/dashboard/agentics')).toBe(false);
    expect(isAgenticsVaultPath('/dashboard/agentics/agents')).toBe(true);
    expect(isAgenticsDoorPath('/dashboard/agentics/agents')).toBe(false);
    expect(existsSync(path.join(ROOT, 'src/pages/dashboard/agentics/agents.astro'))).toBe(true);
  });
});

describe('the home page keeps the door\'s rules for everyone', () => {
  it('needs a real session first: signed out and demo visitors are sent to the Agentics sign-in, before either branch', () => {
    const fm = frontmatter(page);
    const redirect = fm.indexOf("if (!session || session.isDemo) return Astro.redirect('/agentics/login?next=%2Fdashboard%2Fagentics', 303);");
    expect(fm).toContain('const session = await requireTenantSession(Astro.request);');
    expect(redirect).toBeGreaterThan(0);
    expect(redirect).toBeLessThan(fm.indexOf('canAccessAgenticsVault(session)'));
    expect(redirect).toBeLessThan(fm.indexOf('welcomeOnFirstVisit({'));
  });

  it('is never cached or indexed: the letter says so itself, and the Vault page is gated and so answered with the private headers', () => {
    expect(page).toContain("Astro.response.headers.set('Cache-Control', 'private, no-store');");
    expect(page).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(read('src/components/agentics/AgenticsShell.astro')).toContain('<meta name="robots" content="noindex, nofollow" />');
  });
});

describe('the Vault branch', () => {
  it('is chosen by canAccessAgenticsVault(session) and by nothing else, and hands the viewer to the agents page at this address', () => {
    const fm = frontmatter(page);
    expect(fm).toContain("import { canAccessAgenticsVault } from '@/lib/agenticsAccess';");
    expect(fm).toContain("if (canAccessAgenticsVault(session)) return Astro.rewrite('/dashboard/agentics/agents');");
    expect(code(page)).not.toMatch(/isOwner|OWNER_TENANT_ID|@\/lib\/owner|AGENTICS_VAULT_PUBLIC|redirect\('\/dashboard\/agentics\//);
  });

  it('decides before the letter\'s work: the signup claim, the email and the session lookup for the address never run for an account that has the Vault', () => {
    const fm = frontmatter(page);
    const decision = fm.indexOf('canAccessAgenticsVault(session)');
    expect(decision).toBeGreaterThan(0);
    expect(fm.indexOf('getAuthSession(Astro.request)')).toBeGreaterThan(decision);
    expect(fm.indexOf('welcomeOnFirstVisit({')).toBeGreaterThan(decision);
    expect((fm.match(/canAccessAgenticsVault\(/g) ?? []).length).toBe(1);
  });

  it('shows the agents page to an account that may use the Vault and to nobody else, reading the Vault only after it has checked', () => {
    const fm = frontmatter(agents);
    const session = fm.indexOf('const session = await requireTenantSession(Astro.request);');
    const check = fm.indexOf('if (!session || !canAccessAgenticsVault(session)) return new Response(null, { status: 404 });');
    const load = fm.indexOf('loadHomePage(session.tenantId)');
    expect(session).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(session);
    expect(load).toBeGreaterThan(check);
    expect((code(agents).match(/loadHomePage\(/g) ?? []).length).toBe(1);
    expect(code(agents)).not.toMatch(/searchParams|fetch\(|\/api\/agentics|isOwner|OWNER_TENANT_ID/);
    expect(agents).toContain('<AgenticsShell title="Agents" active="agents" plan={home.plan}>');
    expect(agents).toContain('<AgentsHome client:load data={home} />');
  });
});

describe('the letter branch', () => {
  it('imports nothing of the Vault: its page carries none of the Vault\'s styles or code', () => {
    const imports = [...frontmatter(page).matchAll(/^import\s+[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]).sort();
    expect(imports).toEqual([
      '@/components/Analytics.astro',
      '@/components/LogoutButton.astro',
      '@/i18n/agentics',
      '@/lib/agenticsAccess',
      '@/lib/agenticsSignup',
      '@/lib/agenticsSource',
      '@/lib/authSession',
      '@/lib/requireTenantSession',
    ]);
    expect(frontmatter(page)).toContain("import '@/styles/tokens.css';");
    expect(code(page)).not.toMatch(/agentVault|AgentsHome|AgenticsShell|agentics\.css|loadHomePage|getPlanSummary|\/api\/agentics/);
  });

  it('runs the signup claim and the email as it always did, waits a few seconds for it at most, and takes the address from the session', () => {
    const fm = frontmatter(page);
    expect(fm).toContain('const SEND_WAIT_MS = 4000;');
    expect(fm).toMatch(/Promise\.race\(/);
    expect(fm).toContain('email: auth?.user?.email ?? null');
    expect(fm).toContain("source: cleanSource(Astro.url.searchParams.get('src'))");
    expect(code(page)).not.toMatch(/searchParams\.get\('(email|tenant|tenantId)'\)/);
  });

  it('is the letter exactly as it was before the Vault had a home: the markup is byte for byte production\'s', () => {
    // The sha-256 of everything from <!doctype html> to the end of src/pages/dashboard/agentics/index.astro
    // as it was on production (92c5bb3), before this page learned to hand the Vault viewer elsewhere. A
    // change to a word, a tag, a class or a style of the letter changes this, and has to be a decision.
    const i = page.indexOf('<!doctype html>');
    expect(i).toBeGreaterThan(0);
    const markup = page.slice(i);
    expect(markup.length).toBe(3498);
    expect(createHash('sha256').update(markup).digest('hex')).toBe('ea90ffd4f35eb77196acefa554c4c60c2949c11c55fa86d3f8d48fa7c8827284');
  });
});
