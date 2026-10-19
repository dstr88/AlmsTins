import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * The admin side of the opening email: the endpoint (POST sends or counts, GET counts) and the page that
 * calls it. The database is the in-memory stand-in, the mail server is a spy and the admin check is
 * replaced; every address and tenant is invented.
 */
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
const mail = vi.hoisted(() => ({ send: vi.fn<(m: any) => Promise<void>>() }));
vi.mock('@/lib/email', () => ({ sendMail: (m: any) => mail.send(m) }));
const admin = vi.hoisted(() => ({ who: 'admin' as 'admin' | 'user' | 'nobody', checks: 0 }));
vi.mock('@/lib/adminGuard', () => ({
  requireAdminSession: async () => {
    admin.checks += 1;
    if (admin.who === 'nobody') throw new Response('Unauthorized', { status: 401 });
    if (admin.who === 'user') throw new Response('Forbidden', { status: 403 });
    return { userId: 'u-admin', email: 'admin@example.test' };
  },
}));
const flag = vi.hoisted(() => ({ open: false }));
vi.mock('../../src/lib/agenticsFlag.mjs', () => ({ get AGENTICS_VAULT_PUBLIC() { return flag.open; } }));

const ROOT = path.resolve(__dirname, '../..');
const A = 'tenant-a';
const B = 'tenant-b';

let fake: ReceivablesDbFake;
let route: typeof import('../../src/pages/api/admin/agentics-opening');

// The endpoint sends through the Vault's strict sender, which fails when no mail transport is set up (the
// shared mailer, mocked above, would return quietly). A transport is "set up" here by naming one.
const ORIGINAL_TRANSPORT = process.env.EMAIL_SERVER;
afterEach(() => {
  if (ORIGINAL_TRANSPORT === undefined) delete process.env.EMAIL_SERVER;
  else process.env.EMAIL_SERVER = ORIGINAL_TRANSPORT;
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  vi.resetModules();
  process.env.EMAIL_SERVER = 'smtp://mail.example.test';
  vi.stubEnv('AUTH_URL', ''); // the letter's links are built from the site address: a shell that has it set must not change them
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fake = createReceivablesDbFake();
  holder.db = fake;
  mail.send.mockReset().mockResolvedValue(undefined);
  admin.who = 'admin';
  admin.checks = 0;
  flag.open = false;
  await fake.execute({ sql: `CREATE TABLE IF NOT EXISTS tenant_memberships (id TEXT, tenant_id TEXT, user_id TEXT, role TEXT, created_at TEXT)`, args: [] });
  await fake.execute({ sql: `CREATE TABLE IF NOT EXISTS auth_users (id TEXT, email TEXT)`, args: [] });
  for (const [t, u, e] of [[A, 'u1', 'a@example.test'], [B, 'u2', 'b@example.test']]) {
    fake.seed('tenant_memberships', { id: `m-${t}`, tenant_id: t, user_id: u, role: 'owner', created_at: '2026-10-01 00:00:00' });
    fake.seed('auth_users', { id: u, email: e });
  }
  const signup = await import('../../src/lib/agenticsSignup');
  for (const t of [A, B]) { await signup.registerSignup(t, 'direct'); await signup.markWelcomed(t, new Date('2026-10-01T00:00:00Z')); }
  route = await import('../../src/pages/api/admin/agentics-opening');
});

const call = async (method: 'GET' | 'POST', body?: unknown) => {
  const request = new Request('https://almstins.com/api/admin/agentics-opening', {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' || body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = (await (route[method] as any)({ request, url: new URL(request.url) })) as Response;
  return { res, json: (await res.json().catch(() => null)) as any };
};

describe('who may use it', () => {
  it.each([['nobody', 401, 'unauthorized'], ['user', 403, 'forbidden']] as const)('answers %s with %i, before it reads the body, the database or the mail server', async (who, status, error) => {
    admin.who = who;
    for (const method of ['GET', 'POST'] as const) {
      fake.log.length = 0;
      const { res, json } = await call(method, { apply: true });
      expect(res.status, method).toBe(status);
      expect(json).toEqual({ ok: false, error });
      expect(fake.log, method).toEqual([]);
    }
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('is the admin guard of the other admin endpoints, called once for each request', async () => {
    await call('GET');
    await call('POST', {});
    expect(admin.checks).toBe(2);
  });
});

describe('counting', () => {
  it('GET says whether the vault is open and how many accounts have not been told', async () => {
    const { res, json } = await call('GET');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(json).toEqual({ ok: true, vaultOpen: false, waiting: 2 });
  });

  it('a POST with no body, or with apply left out, is a dry run, even while the vault is private', async () => {
    for (const body of [undefined, {}, { apply: false }, { apply: 'yes' }]) {
      const { res, json } = await call('POST', body);
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(json).toEqual({ ok: true, dryRun: true, waiting: 2, sent: 0, failed: 0, timedOut: 0, noEmail: 0, remaining: 2 });
    }
    expect(mail.send).not.toHaveBeenCalled();
  });
});

describe('sending', () => {
  it('is refused until the vault is open, and nothing is written, claimed or sent', async () => {
    fake.log.length = 0;
    const { res, json } = await call('POST', { apply: true });
    expect(res.status).toBe(409);
    expect(json).toEqual({ ok: false, error: 'vault_not_open' });
    expect(mail.send).not.toHaveBeenCalled();
    expect(fake.log.filter((s) => /^UPDATE/i.test(s.sql))).toEqual([]);
  });

  it('once the vault is open it sends the opening email to each account, and answers with numbers only', async () => {
    flag.open = true;
    vi.resetModules();
    route = await import('../../src/pages/api/admin/agentics-opening');
    const { res, json } = await call('POST', { apply: true });
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, dryRun: false, waiting: 2, sent: 2, failed: 0, timedOut: 0, noEmail: 0, remaining: 0 });
    expect(mail.send.mock.calls.map((c) => c[0].to).sort()).toEqual(['a@example.test', 'b@example.test']);
    expect(mail.send.mock.calls[0][0].subject).toBe('Your Agentics vault is open');
    expect(JSON.stringify(json)).not.toMatch(/@|example\.test/);
    // Asked again, there is no one left.
    expect((await call('POST', { apply: true })).json).toMatchObject({ sent: 0, remaining: 0 });
    expect(mail.send).toHaveBeenCalledTimes(2);
  });

  it('honors a limit, and the next call carries on', async () => {
    flag.open = true;
    vi.resetModules();
    route = await import('../../src/pages/api/admin/agentics-opening');
    expect((await call('POST', { apply: true, limit: 1 })).json).toMatchObject({ sent: 1, remaining: 1 });
    expect((await call('POST', { apply: true, limit: 1 })).json).toMatchObject({ sent: 1, remaining: 0 });
  });

  it('refuses a body that is not an object and a limit that is not a number of at least one, before anything runs', async () => {
    flag.open = true;
    vi.resetModules();
    route = await import('../../src/pages/api/admin/agentics-opening');
    expect((await call('POST', '[]')).json).toEqual({ ok: false, error: 'invalid_body' });
    expect((await call('POST', '"x"')).json).toEqual({ ok: false, error: 'invalid_body' });
    for (const limit of [0, -3, 'many', null]) {
      const { res, json } = await call('POST', { apply: true, limit });
      expect(res.status, String(limit)).toBe(400);
      expect(json).toEqual({ ok: false, error: 'invalid_limit' });
    }
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('never takes an address or an account from the request: the list is the signup table', async () => {
    flag.open = true;
    vi.resetModules();
    route = await import('../../src/pages/api/admin/agentics-opening');
    await call('POST', { apply: true, to: 'attacker@example.test', email: 'attacker@example.test', tenantId: 'tenant-zzz' });
    expect(mail.send.mock.calls.map((c) => c[0].to)).not.toContain('attacker@example.test');
    expect(mail.send).toHaveBeenCalledTimes(2);
    const src = readFileSync(path.join(ROOT, 'src/pages/api/admin/agentics-opening.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/body\.(to|email|tenant|tenantId|address)\b/);
  });

  it('with no mail transport set up, a real send FAILS: nobody is marked told for a mail that never went', async () => {
    flag.open = true;
    delete process.env.EMAIL_SERVER;
    vi.resetModules();
    route = await import('../../src/pages/api/admin/agentics-opening');
    const { res, json } = await call('POST', { apply: true });
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, dryRun: false, waiting: 2, sent: 0, failed: 2, timedOut: 0, noEmail: 0, remaining: 2 });
    expect(mail.send).not.toHaveBeenCalled();
    expect(fake.rows('agentics_signups').every((r) => !r.opened_notified_at && !r.open_claimed_at)).toBe(true); // told: no one; claims given back
    expect(console.error).toHaveBeenCalledWith('[agentics] opening email not sent', { name: 'MailUnavailableError', code: 'E_NO_MAIL_TRANSPORT' });
    // Once a transport exists the same accounts are sent to, because none was marked.
    process.env.EMAIL_SERVER = 'smtp://mail.example.test';
    expect((await call('POST', { apply: true })).json).toMatchObject({ sent: 2, failed: 0, remaining: 0 });
    expect(mail.send).toHaveBeenCalledTimes(2);
  });

  it('ends the batch when its time budget is used, so a slow mail server cannot hold a request past what the host allows', async () => {
    flag.open = true;
    vi.resetModules();
    route = await import('../../src/pages/api/admin/agentics-opening');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-19T12:00:00.000Z'));
      // Each send "takes" longer than the whole budget.
      mail.send.mockImplementation(async () => { vi.setSystemTime(Date.now() + route.OPENING_CALL_BUDGET_MS + 1000); });
      const { json } = await call('POST', { apply: true });
      expect(json).toMatchObject({ ok: true, sent: 1, remaining: 1 }); // the second account waits for the next call
      expect(mail.send).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands the shared mailer the letter in html, with replies going to a person', async () => {
    flag.open = true;
    vi.resetModules();
    route = await import('../../src/pages/api/admin/agentics-opening');
    await call('POST', { apply: true, limit: 1 });
    const sent = mail.send.mock.calls[0][0];
    expect(sent.html).toContain('<a href="https://almstins.com/dashboard/agentics"');
    expect(sent.replyTo).toBe('support@almstins.com');
  });

  it('keeps one call within what the host allows: the batch budget plus one send is under 30 seconds', async () => {
    const signup = await import('../../src/lib/agenticsSignup');
    expect(route.OPENING_CALL_BUDGET_MS).toBeLessThanOrEqual(15_000);
    expect(signup.OPENING_SEND_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(route.OPENING_CALL_BUDGET_MS + signup.OPENING_SEND_TIMEOUT_MS).toBeLessThan(25_000);
  });

  it('a database failure is a plain 500 that names nothing', async () => {
    fake.options.failDml = () => true;
    flag.open = true;
    vi.resetModules();
    route = await import('../../src/pages/api/admin/agentics-opening');
    const { res, json } = await call('POST', { apply: true });
    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: 'unavailable' });
  });
});

describe('the page', () => {
  const page = readFileSync(path.join(ROOT, 'src/pages/admin/agentics.astro'), 'utf8');
  const frontmatter = page.split('---')[1] ?? '';

  it('checks for an admin first and sends everyone else away without rendering anything', () => {
    const guard = frontmatter.indexOf('await requireAdminSession(Astro.request);');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(frontmatter.indexOf('countOpeningWaiting()'));
    expect(frontmatter).toContain("if (resp instanceof Response && resp.status === 401) return Astro.redirect('/login', 303);");
    expect(frontmatter).toContain("return Astro.redirect('/dashboard/vault', 303);");
  });

  it('is never cached or indexed, and calls the endpoint with a POST that says whether it is real', () => {
    expect(page).toContain("Astro.response.headers.set('Cache-Control', 'private, no-store');");
    expect(page).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(page).toContain("fetch('/api/admin/agentics-opening', { method: 'POST'");
    expect(page).toContain('body: JSON.stringify({ apply })');
  });

  it('asks before a real send, and says plainly when the vault is private', () => {
    expect(page).toContain("confirm('Send the opening email to the next accounts that have not been told? It goes out for real.')");
    expect(page).toContain('AGENTICS_VAULT_PUBLIC is false');
  });

  it('makes sure the table exists before it counts anything, and says what a timed-out send means', () => {
    expect(frontmatter.indexOf('await ensureAgenticsSignupsTable()')).toBeGreaterThan(0);
    expect(frontmatter.indexOf('await ensureAgenticsSignupsTable()')).toBeLessThan(frontmatter.indexOf('const signups = await count('));
    expect(page).toContain('Timed out ${body.timedOut}');
  });

  it('uses only the design tokens for color, and renders nothing from the database as html', () => {
    const css = page.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(css.length).toBeGreaterThan(100);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(page).not.toMatch(/set:html|innerHTML/);
  });
});
