import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * GET /api/cron/sync-agent-wallets: the Agent Vault's daily read of the chain. The watcher itself is
 * covered in tests/agentics/watcher.test.ts; this is about the door: who may call it, what it
 * hands the caller back (numbers only, because the workflow prints them in a public log), and that a
 * failure shows no details.
 */

const watcher = vi.hoisted(() => ({
  runAllTins: vi.fn(),
  defaultWatchDeps: { sentinel: true },
}));
vi.mock('@/lib/agentVault/watcher', () => watcher);

import { GET } from '../../src/pages/api/cron/sync-agent-wallets';

const call = (headers: Record<string, string> = {}, query = '') =>
  GET({ request: new Request(`https://app.test/api/cron/sync-agent-wallets${query}`, { headers }) } as never) as Promise<Response>;

const SUMMARY = { tins: 3, wallets: 5, complete: 4, partial: 1, unavailable: 0, failed: 0, recorded: 12, truncated: false };

beforeEach(() => {
  watcher.runAllTins.mockReset().mockResolvedValue(SUMMARY);
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
    expect(watcher.runAllTins).not.toHaveBeenCalled();
  });

  it('nobody with the wrong secret', async () => {
    expect((await call({ 'x-cron-secret': 'nope' })).status).toBe(401);
    expect((await call({}, '?secret=nope')).status).toBe(401);
    expect(watcher.runAllTins).not.toHaveBeenCalled();
  });

  it('nobody when the secret is not configured, even by sending nothing', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call()).status).toBe(401);
    expect((await call({ 'x-cron-secret': '' })).status).toBe(401);
    expect(watcher.runAllTins).not.toHaveBeenCalled();
  });

  it('the secret in the header, or in the query like the other jobs', async () => {
    expect((await call({ 'x-cron-secret': 'test-secret' })).status).toBe(200);
    expect((await call({}, '?secret=test-secret')).status).toBe(200);
    expect(watcher.runAllTins).toHaveBeenCalledTimes(2);
  });
});

describe('what it does and answers', () => {
  it('runs the watcher with a deadline inside the workflow\'s ten minutes, and answers numbers and true/false only', async () => {
    const before = Date.now();
    const r = await call({ 'x-cron-secret': 'test-secret' });
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const body = await r.json();
    expect(body).toEqual({ ok: true, elapsed_ms: expect.any(Number), ...SUMMARY });
    expect(Object.values(body).every((v) => typeof v === 'number' || typeof v === 'boolean')).toBe(true);

    const [deps, opts] = watcher.runAllTins.mock.calls[0];
    expect(deps).toBe(watcher.defaultWatchDeps);
    expect(opts.deadlineAt).toBeGreaterThanOrEqual(before + 8 * 60_000);
    expect(opts.deadlineAt).toBeLessThanOrEqual(Date.now() + 9 * 60_000);
  });

  it('a failure is a plain 500 that names nothing, and is logged by name and code only', async () => {
    watcher.runAllTins.mockRejectedValue(Object.assign(new Error('relation "agent_events" has 0xc0ffee in it'), { name: 'DatabaseError', code: '57P01' }));
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
