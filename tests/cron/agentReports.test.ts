import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * GET /api/cron/agent-reports: the Agent Vault's daily report job. The job itself is covered in
 * tests/agentics/reportJob.test.ts; this is about the door: who may call it, what it hands the
 * caller back (numbers only, because the workflow prints them in a public log), and that a failure
 * shows no details.
 */
const job = vi.hoisted(() => ({
  runAgentReports: vi.fn(),
  defaultJobDeps: vi.fn(() => ({ sentinel: true })),
}));
vi.mock('@/lib/agentVault/reportJob', () => job);

import { GET } from '../../src/pages/api/cron/agent-reports';

const ROOT = path.resolve(__dirname, '../..');
const call = (headers: Record<string, string> = {}, query = '') =>
  GET({ request: new Request(`https://app.test/api/cron/agent-reports${query}`, { headers }) } as never) as Promise<Response>;

const SUMMARY = {
  tins: 3, active: 2, created: 2, unchanged: 0, failedReports: 0, optedIn: 1, sent: 1, notNeeded: 0, noRecipient: 0, alreadySent: 0, failedSends: 0, truncated: false,
};

beforeEach(() => {
  job.runAgentReports.mockReset().mockResolvedValue(SUMMARY);
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('who may call it', () => {
  it('nobody without the secret: 401, and the job does not run', async () => {
    const r = await call();
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ ok: false, error: 'unauthorized' });
    expect(job.runAgentReports).not.toHaveBeenCalled();
  });

  it('nobody with the wrong secret', async () => {
    expect((await call({ 'x-cron-secret': 'nope' })).status).toBe(401);
    expect((await call({}, '?secret=nope')).status).toBe(401);
    expect(job.runAgentReports).not.toHaveBeenCalled();
  });

  it('nobody when the secret is not configured, even by sending nothing', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call()).status).toBe(401);
    expect((await call({ 'x-cron-secret': '' })).status).toBe(401);
    expect(job.runAgentReports).not.toHaveBeenCalled();
  });

  it('the secret in the header, or in the query like the other jobs', async () => {
    expect((await call({ 'x-cron-secret': 'test-secret' })).status).toBe(200);
    expect((await call({}, '?secret=test-secret')).status).toBe(200);
    expect(job.runAgentReports).toHaveBeenCalledTimes(2);
  });
});

describe('what it does and answers', () => {
  it('runs the job with a deadline inside the workflow\'s ten minutes, and answers numbers and true/false only', async () => {
    const before = Date.now();
    const r = await call({ 'x-cron-secret': 'test-secret' });
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const body = await r.json();
    expect(body).toEqual({ ok: true, elapsed_ms: expect.any(Number), ...SUMMARY });
    expect(Object.values(body).every((v) => typeof v === 'number' || typeof v === 'boolean')).toBe(true);

    const [deps, opts] = job.runAgentReports.mock.calls[0];
    expect(deps).toEqual({ sentinel: true });
    expect(opts.deadlineAt).toBeGreaterThanOrEqual(before + 8 * 60_000);
    expect(opts.deadlineAt).toBeLessThanOrEqual(Date.now() + 9 * 60_000);
  });

  it('a failure is a plain 500 that names nothing, and is logged by name and code only', async () => {
    job.runAgentReports.mockRejectedValue(Object.assign(new Error('relation "agent_events" has operator@example.test in it'), { name: 'DatabaseError', code: '57P01' }));
    const r = await call({ 'x-cron-secret': 'test-secret' });
    expect(r.status).toBe(500);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: 'run_failed' });
    expect(text).not.toMatch(/agent_events|operator@/);
    const logged = JSON.stringify((console.error as any).mock.calls);
    expect(logged).toContain('DatabaseError');
    expect(logged).toContain('57P01');
    expect(logged).not.toMatch(/agent_events|operator@/);
  });
});

describe('the workflow that calls it', () => {
  const wf = readFileSync(path.join(ROOT, '.github/workflows/agent-reports.yml'), 'utf8');
  const watcher = readFileSync(path.join(ROOT, '.github/workflows/sync-agent-wallets.yml'), 'utf8');
  const cronOf = (text: string) => /cron:\s*'(\d+) (\d+) \* \* \*'/.exec(text);

  it('runs once a day, after the chain watcher has had its whole budget', () => {
    const mine = cronOf(wf);
    const theirs = cronOf(watcher);
    expect(mine && theirs).toBeTruthy();
    const minutes = (m: RegExpExecArray) => Number(m[2]) * 60 + Number(m[1]);
    // The watcher stops starting reads after nine minutes, so this runs at least ten minutes later.
    expect(minutes(mine!) - minutes(theirs!)).toBeGreaterThanOrEqual(10);
  });

  it('calls this endpoint through the retry wrapper, with the secret in a header, and prints numbers and true/false only', () => {
    expect(wf).toContain('/api/cron/agent-reports?secret=$CRON_SECRET');
    expect(wf).toContain('bash scripts/cron-curl.sh');
    expect(wf).toContain('-H "x-cron-secret: $CRON_SECRET"');
    expect(wf).toContain(`jq -c 'with_entries(select(.value | type == "number" or type == "boolean"))'`);
    expect(wf).toMatch(/--max-time 600/);
  });
});
