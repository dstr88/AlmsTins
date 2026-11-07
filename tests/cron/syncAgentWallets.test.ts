import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * GET /api/cron/sync-agent-wallets: one call of the Agent Vault's daily read of the chain. The watcher
 * itself is covered in tests/agentics/watcher.test.ts and the day's pass in tests/agentics/syncPass.test.ts;
 * this is about the door: who may call it, what it
 * hands the caller back (numbers only, because the workflow prints them in a public log), and that a
 * failure shows no details.
 */

const watcher = vi.hoisted(() => ({
  runSyncCall: vi.fn(),
  defaultWatchDeps: { sentinel: true },
}));
vi.mock('@/lib/agentVault/watcher', () => ({ defaultWatchDeps: watcher.defaultWatchDeps }));
vi.mock('@/lib/agentVault/syncPass', () => ({ runSyncCall: watcher.runSyncCall }));
// The real secret check, watched: the route has to ask it, with the secret and what the caller sent.
const guard = vi.hoisted(() => ({ calls: [] as Array<[unknown, unknown]> }));
vi.mock('@/lib/agentVault/cronAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/agentVault/cronAuth')>();
  return {
    cronSecretMatches: (configured: unknown, provided: unknown) => {
      guard.calls.push([configured, provided]);
      return actual.cronSecretMatches(configured, provided);
    },
  };
});

import { GET } from '../../src/pages/api/cron/sync-agent-wallets';

const call = (headers: Record<string, string> = {}, query = '') =>
  GET({ request: new Request(`https://app.test/api/cron/sync-agent-wallets${query}`, { headers }) } as never) as Promise<Response>;

const SUMMARY = {
  done: false, remaining: 7, tins: 3, wallets: 5, complete: 4, partial: 1, unavailable: 0, failed: 0, recorded: 12, truncated: true,
  pass_wallets: 9, pass_complete: 8, pass_partial: 1, pass_unavailable: 0, pass_failed: 0, pass_recorded: 20,
};

beforeEach(() => {
  guard.calls = [];
  watcher.runSyncCall.mockReset().mockResolvedValue(SUMMARY);
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('who may call it', () => {
  it('nobody without the secret: 401, and the watcher does not run', async () => {
    const r = await call();
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ ok: false, error: 'unauthorized' });
    expect(watcher.runSyncCall).not.toHaveBeenCalled();
  });

  it('nobody with the wrong secret', async () => {
    expect((await call({ 'x-cron-secret': 'nope' })).status).toBe(401);
    expect((await call({}, '?secret=nope')).status).toBe(401);
    expect(watcher.runSyncCall).not.toHaveBeenCalled();
  });

  it('nobody when the secret is not configured, even by sending nothing', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call()).status).toBe(401);
    expect((await call({ 'x-cron-secret': '' })).status).toBe(401);
    expect(watcher.runSyncCall).not.toHaveBeenCalled();
  });

  it('the secret in the header, or in the query like the other jobs', async () => {
    expect((await call({ 'x-cron-secret': 'test-secret' })).status).toBe(200);
    expect((await call({}, '?secret=test-secret')).status).toBe(200);
    expect(watcher.runSyncCall).toHaveBeenCalledTimes(2);
  });

  it('nobody when the secret is not set at all (not only empty), whatever is sent', async () => {
    vi.stubEnv('CRON_SECRET', undefined);
    for (const [headers, query] of [[{}, ''], [{ 'x-cron-secret': '' }, ''], [{ 'x-cron-secret': 'undefined' }, ''], [{}, '?secret='], [{}, '?secret=undefined'], [{ 'x-cron-secret': 'test-secret' }, '']] as const) {
      expect((await call({ ...headers }, query)).status, JSON.stringify([headers, query])).toBe(401);
    }
    expect(watcher.runSyncCall).not.toHaveBeenCalled();
  });

  it('nobody with a secret that is a prefix of the real one, one byte longer, or a different length altogether', async () => {
    for (const wrong of ['test-secre', 'test-secret-and-more', 't', 'x'.repeat(10_000), 'TEST-SECRET', 'test-secretx']) {
      expect((await call({ 'x-cron-secret': wrong })).status, wrong.slice(0, 20)).toBe(401);
      expect((await call({}, `?secret=${encodeURIComponent(wrong)}`)).status, wrong.slice(0, 20)).toBe(401);
    }
    // A header loses its edge whitespace on the way in; a query value keeps it, so there it is a different secret.
    expect((await call({}, `?secret=${encodeURIComponent('test-secret ')}`)).status).toBe(401);
    expect(watcher.runSyncCall).not.toHaveBeenCalled();
  });

  it('a wrong header wins over a right query: the header is what was sent', async () => {
    expect((await call({ 'x-cron-secret': 'nope' }, '?secret=test-secret')).status).toBe(401);
  });

  it('asks the shared constant-time check, with the configured secret and what the caller sent, and nothing else decides', async () => {
    await call({ 'x-cron-secret': 'test-secret' });
    await call({}, '?secret=other');
    await call();
    expect(guard.calls).toEqual([['test-secret', 'test-secret'], ['test-secret', 'other'], ['test-secret', null]]);
    const src = readFileSync(path.resolve(__dirname, '../../src/pages/api/cron/sync-agent-wallets.ts'), 'utf8');
    expect(src).toMatch(/cronSecretMatches\(secret, provided\)/);
    expect(src).not.toMatch(/provided\s*[!=]==?\s*secret|secret\s*[!=]==?\s*provided/);
  });
});

describe('what it does and answers', () => {
  it('runs one call of the day\'s pass with a deadline inside the workflow\'s ten minutes, and answers numbers and true/false only', async () => {
    const before = Date.now();
    const r = await call({ 'x-cron-secret': 'test-secret' });
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const body = await r.json();
    expect(body).toEqual({ ok: true, elapsed_ms: expect.any(Number), ...SUMMARY });
    expect(Object.values(body).every((v) => typeof v === 'number' || typeof v === 'boolean')).toBe(true);

    const [deps, opts] = watcher.runSyncCall.mock.calls[0];
    expect(deps).toBe(watcher.defaultWatchDeps);
    expect(opts.deadlineAt).toBeGreaterThanOrEqual(before + 8 * 60_000);
    expect(opts.deadlineAt).toBeLessThanOrEqual(Date.now() + 9 * 60_000);
  });

  it('a failure is a plain 500 that names nothing, and is logged by name and code only', async () => {
    watcher.runSyncCall.mockRejectedValue(Object.assign(new Error('relation "agent_events" has 0xc0ffee in it'), { name: 'DatabaseError', code: '57P01' }));
    const r = await call({ 'x-cron-secret': 'test-secret' });
    expect(r.status).toBe(500);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: 'run_failed' });
    expect(text).not.toMatch(/agent_events|0xc0ffee/);
    const logged = JSON.stringify((console.error as any).mock.calls);
    expect(logged).toContain('DatabaseError');
    expect(logged).toContain('57P01');
    expect(logged).not.toMatch(/agent_events|0xc0ffee/);
  });
});

describe('the workflow that calls it', () => {
  const wf = readFileSync(path.resolve(__dirname, '../../.github/workflows/sync-agent-wallets.yml'), 'utf8');

  it('sends the secret in a header only: it is never in the URL', () => {
    expect(wf).toContain('"$SYNC_URL/api/cron/sync-agent-wallets"');
    expect(wf).not.toContain('?secret=');
    expect(wf).toContain('-H "x-cron-secret: $CRON_SECRET"');
    expect(wf).toContain('bash scripts/cron-curl.sh');
    expect(wf).toContain(`jq -c 'with_entries(select(.value | type == "number" or type == "boolean"))'`);
  });

  it('calls again until the pass is done, each call with --fail and a ten-minute --max-time, and two loops never overlap', () => {
    expect(wf).toMatch(/while :; do[\s\S]*bash scripts\/cron-curl\.sh -sS --fail --max-time 600[\s\S]*\.done == true[\s\S]*break[\s\S]*done/);
    expect(wf).toMatch(/^concurrency:\n  group: sync-agent-wallets\n  cancel-in-progress: false$/m);
    // GitHub stops a job at six hours (360 minutes); the loop job gets well over today's one call.
    const timeout = Number(/^    timeout-minutes: (\d+)$/m.exec(wf)?.[1]);
    expect(timeout).toBeGreaterThanOrEqual(120);
    expect(timeout).toBeLessThanOrEqual(360);
    expect(wf).toMatch(/^    - cron: '10 8 \* \* \*'$/m);
  });

  it('runs Agent Reports after the pass is done, and only then', () => {
    expect(wf).toMatch(/^  agent-reports:\n    needs: sync-agent-wallets\n    if: \$\{\{ always\(\) && needs\.sync-agent-wallets\.outputs\.done == 'true' \}\}\n    uses: \.\/\.github\/workflows\/agent-reports\.yml\n    secrets: inherit$/m);
    expect(wf).toMatch(/outputs:\n      done: \$\{\{ steps\.sync\.outputs\.done \}\}/);
    expect(wf).toMatch(/echo "done=true" >> "\$GITHUB_OUTPUT"/);
  });
});
