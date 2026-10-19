import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { brightLineViolations } from '../helpers/brightLineWording';
import { DELETE_WAIT_MS, deleteOutcome, withWait } from '../../src/components/agentics/account';
import { ACCOUNT_SET_UP, ACCOUNT_SIGN_IN, accountEntry } from '../../src/lib/agenticsAccountEntry';
import { copy } from '../../src/components/agentics/copy';
import { ACCOUNT_PATH, AFTER_DELETE_PATH } from '../../src/components/agentics/paths';
import type { ApiResult } from '../../src/components/agentics/client';

/**
 * The Agentics account page (/agentics/account): who is signed in, the plan, and deleting the account.
 * The page is an Astro file, which this suite cannot render, so its rules are pinned as source (the way
 * doorPages.test.ts pins the door); the panel is rendered the way the server renders it, and the meaning
 * of the delete request's answer is a pure function. The built server is exercised by hand. Every
 * address and name here is invented.
 */
let AccountPanel: typeof import('../../src/components/agentics/AccountPanel').default;
beforeAll(async () => {
  (globalThis as { React?: typeof React }).React = React;
  AccountPanel = (await import('../../src/components/agentics/AccountPanel')).default;
});

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const result = (over: Partial<ApiResult>): ApiResult => ({ status: 200, ok: true, body: { ok: true }, ...over });

describe('what the delete request\'s answer means', () => {
  it('deleted: the app said ok', () => {
    expect(deleteOutcome(result({}))).toEqual({ kind: 'deleted' });
  });

  it('an answer that is a success status but says nothing, or says not ok, is not a deletion', () => {
    for (const r of [result({ body: null }), result({ body: {} }), result({ body: { ok: false } }), result({ ok: false, body: { ok: true } })]) {
      expect(deleteOutcome(r).kind, JSON.stringify(r)).toBe('kept');
    }
  });

  it('a paid plan that could not be canceled keeps the account, and says why', () => {
    const r = result({ status: 502, ok: false, body: { ok: false, code: 'billing_cancel_failed', error: 'Your account was not deleted because ...' } });
    expect(deleteOutcome(r)).toEqual({ kind: 'kept', text: copy.account.billingFailed });
  });

  it('a request that got no answer does NOT say the account was kept: it may have finished, and says how to find out', () => {
    const out = deleteOutcome(result({ status: 0, ok: false, body: null }));
    expect(out).toEqual({ kind: 'kept', text: copy.account.unclear });
    expect(copy.account.unclear).toContain('cannot say whether your account was deleted');
    expect(copy.account.unclear).toContain('if you are still signed in, it was not deleted');
    // It never asserts the account is still there: only the conditional ("if you are still signed in").
    expect(copy.account.unclear).not.toMatch(/^Your account was not deleted|nothing was deleted/);
  });

  it('a 401 means the session is gone, which a finished deletion also does: it says both are possible', () => {
    // The repeat of a request whose answer was lost comes back 401, because the account and its session are gone.
    expect(deleteOutcome(result({ status: 401, ok: false, body: { ok: false, error: 'Unauthorized' } }))).toEqual({ kind: 'kept', text: copy.account.signedOut });
    expect(copy.account.signedOut).toContain('If your account was deleted you cannot sign in to it again');
    expect(copy.account.signedOut).not.toMatch(/^Your account was not deleted|nothing was deleted/);
  });

  it.each([502, 503, 504])('an answer from the host in front of the app (%i, no JSON) may be a request that finished: it says it does not know', (status) => {
    expect(deleteOutcome(result({ status, ok: false, body: null }))).toEqual({ kind: 'kept', text: copy.account.unclear });
  });

  it.each([404, 500])('the app\'s own failure (%i) keeps the account, says part of it may already be gone, and gives the general words, never the server\'s text', (status) => {
    const r = result({ status, ok: false, body: { ok: false, error: 'Failed to delete account. Please contact support. (stack trace)' } });
    expect(deleteOutcome(r)).toEqual({ kind: 'kept', text: copy.account.failed });
    expect(copy.account.failed).toContain('an agent key, may already be gone');
    expect(JSON.stringify(deleteOutcome(r))).not.toContain('stack trace');
  });
});

describe('the wait for the answer', () => {
  it('ends with "no answer" when the request hangs, so the button does not stay on "Deleting" for ever', async () => {
    vi.useFakeTimers();
    try {
      const hung = withWait(new Promise<ApiResult>(() => {}));
      await vi.advanceTimersByTimeAsync(DELETE_WAIT_MS - 1);
      let settled = false;
      void hung.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await hung).toEqual({ status: 0, ok: false, body: null });
      expect(DELETE_WAIT_MS).toBeGreaterThan(30_000); // longer than the host's own cut, so a 502 can arrive first
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the answer as it came, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    try {
      const answer = result({ body: { ok: true } });
      expect(await withWait(Promise.resolve(answer))).toBe(answer);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the words', () => {
  it('keep the product wording, in every line of the account block', () => {
    const lines = [copy.account.lede, copy.account.plan, copy.account.planUnlimited, ...copy.account.deleteLede, copy.account.deleteQuestion, copy.account.failed, copy.account.billingFailed, copy.account.unclear, copy.account.signedOut, copy.account.done];
    for (const text of lines) expect(brightLineViolations(text), text).toEqual([]);
  });

  it('say what deletion removes, what it keeps, and that it cannot be undone', () => {
    const lede = copy.account.deleteLede.join(' ');
    for (const word of ['agents', 'wallets', 'registered addresses', 'ledger', 'reports', 'delivery settings', 'cannot be undone', 'agent keys', 'signed file you already downloaded', 'financing claims']) {
      expect(lede, word).toContain(word);
    }
  });

  it('say that it is the WHOLE Almstins account, tracker and PetroTins data included, and that a paid plan is canceled at once', () => {
    // The page is for every signed-in account, and the request removes everything the account holds (accountDeleteTables.ts).
    const lede = copy.account.deleteLede.join(' ');
    for (const word of ['whole Almstins account', 'not only what you keep in Agentics', 'tracked wallets', 'imported transactions', 'tax records', 'PetroTins data', 'your sign-in', 'canceled at once, not at the end of the period']) {
      expect(lede, word).toContain(word);
    }
    expect(copy.account.deleteQuestion).toContain('whole Almstins account');
  });

  it('name the plan the account is on: the Free numbers, or Unlimited for the account that has no limit', () => {
    expect(copy.account.planUnlimited).toBe('Unlimited: this account has no limit on bots or addresses.');
  });

  it('name the free plan with the numbers the door promises, and no price', () => {
    expect(copy.account.plan).toBe('Free: 3 bots and 15 addresses. Paid plans come later; there is nothing to buy today.');
    expect(copy.account.plan).not.toMatch(/\$\s?\d/);
  });
});

describe('the panel', () => {
  it('shows the address the person signed in with as text, whatever it holds', () => {
    const hostile = '"><img src=x onerror=alert(1)>@example.test';
    const html = render(React.createElement(AccountPanel, { email: hostile }));
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('&lt;img');
    expect(textOf(html)).toContain(hostile);
  });

  it('shows the plan the page was given: Free by default, Unlimited when it is', () => {
    expect(textOf(render(React.createElement(AccountPanel, { email: 'a@example.test' })))).toContain(`Plan: ${copy.account.plan}`);
    expect(textOf(render(React.createElement(AccountPanel, { email: 'a@example.test', plan: 'free' })))).toContain(`Plan: ${copy.account.plan}`);
    const unlimited = textOf(render(React.createElement(AccountPanel, { email: 'a@example.test', plan: 'unlimited' })));
    expect(unlimited).toContain(`Plan: ${copy.account.planUnlimited}`);
    expect(unlimited).not.toContain('Free: 3 bots');
  });

  it('says when a sign-in has no email on it', () => {
    expect(textOf(render(React.createElement(AccountPanel, { email: null })))).toContain(copy.account.noEmail);
  });

  it('offers deletion as one plain button, and asks the question in place only when it is pressed', () => {
    const html = render(React.createElement(AccountPanel, { email: 'a@example.test' }));
    expect(html).toMatch(/<button[^>]*>Delete my account<\/button>/);
    expect(html).not.toContain('ag-confirm');
    expect(textOf(html)).not.toContain(copy.account.deleteQuestion);
    expect(textOf(html)).toContain('This permanently deletes your whole Almstins account and everything in it');
  });

  it('is labeled, uses only Agentics\' classes, and builds nothing from data', () => {
    const html = render(React.createElement(AccountPanel, { email: 'a@example.test' }));
    for (const m of html.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/).filter(Boolean)) expect(c, c).toMatch(/^ag-/);
    expect(html).toContain('aria-labelledby="ag-account-h"');
    expect(html).toContain('aria-labelledby="ag-delete-h"');
    expect(read('src/components/agentics/AccountPanel.tsx')).not.toMatch(/innerHTML|set:html|dangerouslySetInnerHTML/);
  });

  it('sends the app\'s one account deletion with no body, and leaves for the Agentics page only when the answer says it is gone', () => {
    const src = read('src/components/agentics/AccountPanel.tsx');
    expect(src).toContain("withWait(send('POST', '/api/account/delete'))");
    expect(src).toMatch(/if \(outcome\.kind === 'deleted'\) \{\s*window\.location\.assign\(AFTER_DELETE_PATH\);\s*return;\s*\}/);
    expect(AFTER_DELETE_PATH).toBe('/agentics');
    expect(src).toMatch(/if \(working\) return;/); // a second press while it works does nothing
  });
});

describe('who may see the page, and where everyone else goes', () => {
  const real = { tenantId: 'tenant-a' };
  it('an account with a real session sees it', () => {
    expect(accountEntry({ signedIn: true, session: real })).toEqual({ kind: 'page', session: real });
  });

  it('a visitor with no sign-in, and a demo session, are sent to the Agentics sign-in, back to the page', () => {
    for (const input of [{ signedIn: false, session: null }, { signedIn: false, session: { tenantId: 'demo', isDemo: true } }]) {
      expect(accountEntry(input), JSON.stringify(input)).toEqual({ kind: 'redirect', to: ACCOUNT_SIGN_IN });
    }
    expect(ACCOUNT_SIGN_IN).toBe('/agentics/login?next=%2Fagentics%2Faccount');
  });

  it('a real sign-in with no account yet goes to the account set-up, never to the sign-in that would send it straight back', () => {
    expect(accountEntry({ signedIn: true, session: null })).toEqual({ kind: 'redirect', to: ACCOUNT_SET_UP });
    expect(ACCOUNT_SET_UP).toBe('/onboarding/tenant-setup');
  });

  it('a demo cookie does not turn a real sign-in into a demo: a real session with a demo flag set false is a page', () => {
    expect(accountEntry({ signedIn: true, session: { tenantId: 't', isDemo: false } }).kind).toBe('page');
  });
});

describe('the page', () => {
  const page = read('src/pages/agentics/account.astro');
  const frontmatter = page.split('---')[1] ?? '';

  it('is at /agentics/account and needs a real session: a signed-out or demo visitor is sent to the Agentics sign-in, back to here', () => {
    expect(ACCOUNT_PATH).toBe('/agentics/account');
    expect(frontmatter).toContain('const session = await requireTenantSession(Astro.request);');
    expect(frontmatter).toContain('const entry = accountEntry({ signedIn: Boolean(auth?.user?.id), session });');
    expect(frontmatter).toContain("if (entry.kind === 'redirect') return Astro.redirect(entry.to, 303);");
    // The decision is read before anything is rendered or fetched for the page.
    expect(frontmatter.indexOf("if (entry.kind === 'redirect')")).toBeLessThan(frontmatter.indexOf('getEntitlements('));
    expect(frontmatter.indexOf("if (entry.kind === 'redirect')")).toBeLessThan(frontmatter.indexOf("Astro.response.headers.set('Cache-Control'"));
  });

  it('is never cached or indexed, and is titled with a fixed word', () => {
    expect(frontmatter).toContain("Astro.response.headers.set('Cache-Control', 'private, no-store');");
    expect(page).toContain('<AgenticsShell title="Account" active="account"');
    expect(read('src/components/agentics/AgenticsShell.astro')).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it('takes the address from the signed-in session, never from the request, and shows the Vault\'s links only to an account that has the Vault', () => {
    expect(frontmatter).toContain('const email = auth?.user?.email ?? null;');
    expect(page).not.toMatch(/searchParams/);
    expect(page).toContain('vault={canAccessAgenticsVault(entry.session)}');
    expect(page.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/@\/lib\/owner|OWNER_TENANT_ID|isOwner|AGENTICS_VAULT_PUBLIC/);
  });

  it('is not a Vault page and not a public one: it sits outside the Vault\'s prefixes and is not in isPublicPath', () => {
    const access = read('src/lib/agenticsAccess.ts');
    expect(access).toContain("const AGENTICS_VAULT_PREFIXES = ['/dashboard/agentics', '/api/agentics'] as const;");
    expect(read('src/middleware/auth.ts')).not.toMatch(/\/agentics\/account/);
  });
});

describe('the shell and the sign-in redirect', () => {
  const shell = read('src/components/agentics/AgenticsShell.astro');

  it('always has the account link, and has the Vault\'s two places and the meter only for an account that has the Vault', () => {
    expect(shell).toMatch(/<a href=\{ACCOUNT_PATH\} aria-current=\{active === 'account' \? 'page' : undefined\}>\{copy\.nav\.account\}<\/a>/);
    expect(shell).toMatch(/\{vault && <a href=\{HOME_PATH\} aria-current=\{active === 'agents' \? 'page' : undefined\}>/);
    expect(shell).toMatch(/\{vault && <a href=\{REPORTS_PATH\} aria-current=\{active === 'reports' \? 'page' : undefined\}>/);
    expect(shell).toMatch(/\{vault && plan && <PlanMeter client:load plan=\{plan\} \/>\}/);
    expect(shell).toContain('vault = true');
  });

  it('a signed-out visitor of the account page is sent to the Agentics sign-in, ahead of the general /login, back to the page', () => {
    const app = read('src/middleware/app.ts');
    const branch = app.indexOf("oneSlashes.replace(/\\/+$/, '') === '/agentics/account'");
    const general = app.indexOf('const loginPath = ');
    expect(branch).toBeGreaterThan(0);
    expect(general).toBeGreaterThan(branch);
    expect(app.slice(branch, general)).toContain('/agentics/login?next=${next}');
    expect(app.slice(branch, general)).toContain("encodeURIComponent(oneSlashes.replace(/(.)\\/+$/, '$1'))");
  });

  it('the letter lists the account page among the things an account can do', () => {
    // Data, not markup: the letter\'s markup is unchanged, so its pin (home.test.ts) holds.
    expect(read('src/i18n/agentics.ts')).toContain("{ href: '/agentics/account', text: 'See your account, or delete it.' }");
  });
});
