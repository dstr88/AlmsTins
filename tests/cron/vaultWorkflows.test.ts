import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The two Agent Vault workflows, run for real. Each one's `run:` script is taken out of the
 * workflow file and executed with bash the way GitHub does (`bash -eo pipefail`), with a fake
 * `curl` on the PATH that writes a chosen answer where the script asks for it, and the real `jq`.
 * No network. What is pinned:
 *
 *   - the job goes RED (exit 1) when the answer says a report or a send failed, a wallet failed, or
 *     the run was cut short, and when the answer is not JSON or not ok; it stays green otherwise;
 *   - this repository's Actions logs are public, so only numbers and true/false are ever printed,
 *     and the red message names no value.
 *
 * The workflows' other shape (the retry wrapper, the schedule, the numbers-only line) is pinned in
 * tests/cron/agentReports.test.ts, tests/cron/syncAgentWallets.test.ts and
 * tests/ci/cronLogsNoUserData.test.ts. Every value here is invented.
 */
const ROOT = path.resolve(__dirname, '../..');
const CANARY_SECRET = 'cron-secret-canary-8c21';
const CANARY_TEXT = 'operator@example.test';

/** The `run:` script of a workflow's one run step, dedented. */
function runScriptOf(file: string): string {
  const lines = readFileSync(path.join(ROOT, '.github/workflows', file), 'utf8').split('\n');
  const at = lines.findIndex((l) => /^\s+run: \|\s*$/.test(l));
  expect(at, `${file} has a run step`).toBeGreaterThan(-1);
  expect(lines.filter((l) => /^\s+run:/.test(l)), `${file} has exactly one run step`).toHaveLength(1);
  const indent = (l: string) => l.match(/^\s*/)![0].length;
  const body: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() !== '' && indent(l) <= indent(lines[at])) break;
    body.push(l);
  }
  const strip = indent(body.find((l) => l.trim() !== '')!);
  return body.map((l) => l.slice(Math.min(strip, indent(l)))).join('\n');
}

let binDir: string;
let work: string;

beforeAll(() => {
  binDir = mkdtempSync(path.join(tmpdir(), 'vault-workflow-bin-'));
  work = mkdtempSync(path.join(tmpdir(), 'vault-workflow-run-'));
  // Writes $FAKE_ANSWER to the file after -o, records the arguments, exits with $FAKE_CURL_EXIT.
  writeFileSync(
    path.join(binDir, 'curl'),
    [
      '#!/bin/sh',
      'out=""',
      'prev=""',
      'for a in "$@"; do',
      '  [ "$prev" = "-o" ] && out="$a"',
      '  prev="$a"',
      'done',
      'printf "%s\\n" "$@" > "$RUNNER_TEMP/curl-args.txt"',
      '[ -n "$out" ] && printf "%s" "$FAKE_ANSWER" > "$out"',
      'echo "HTTP 200"',
      'exit "${FAKE_CURL_EXIT:-0}"',
      '',
    ].join('\n'),
  );
  chmodSync(path.join(binDir, 'curl'), 0o755);
});
afterAll(() => {
  rmSync(binDir, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

function run(file: string, answer: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', runScriptOf(file)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      RUNNER_TEMP: work,
      SYNC_URL: 'https://app.example.test',
      CRON_SECRET: CANARY_SECRET,
      FAKE_ANSWER: answer,
      CRON_CURL_RETRY_DELAY: '0',
      ...env,
    },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, args: readFileSync(path.join(work, 'curl-args.txt'), 'utf8').split('\n') };
}

const REPORTS = 'agent-reports.yml';
const reportsAnswer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    ok: true, elapsed_ms: 1234, tins: 3, active: 3, created: 2, unchanged: 1, failedReports: 0, optedIn: 1, sent: 1, notNeeded: 0, noRecipient: 0, alreadySent: 0,
    failedSends: 0, truncated: false, ...over,
  });

describe('Agent Reports goes red when the run says something went wrong', () => {
  it('stays green for a clean run, and prints the numbers', () => {
    const r = run(REPORTS, reportsAnswer());
    expect(r.status).toBe(0);
    expect(r.out).toContain('"failedReports":0');
    expect(r.out).toContain('"truncated":false');
    expect(r.out).not.toMatch(/problem/i);
  });

  it.each([
    ['a report that could not be made', { failedReports: 1 }],
    ['an email that could not be sent', { failedSends: 1 }],
    ['several of each', { failedReports: 4, failedSends: 2 }],
    ['a run the deadline cut short', { truncated: true }],
    ['an answer that is not ok', { ok: false }],
  ])('goes red for %s, after printing the numbers', (_name, over) => {
    const r = run(REPORTS, reportsAnswer(over));
    expect(r.status).toBe(1);
    expect(r.out).toContain('"tins":3'); // the numbers line came first
    expect(r.out).toMatch(/finished with a problem/);
  });

  it('goes red for an answer that is not JSON at all, and for no answer', () => {
    expect(run(REPORTS, '<html>Bad gateway</html>').status).toBe(1);
    expect(run(REPORTS, '').status).toBe(1);
  });

  it('other counts never turn it red: only the three problems do', () => {
    const r = run(REPORTS, reportsAnswer({ noRecipient: 5, notNeeded: 7, alreadySent: 2, unchanged: 40 }));
    expect(r.status).toBe(0);
  });

  it('prints only numbers and true/false: a string in the answer, or the secret, never reaches the log', () => {
    for (const over of [{ note: CANARY_TEXT }, { note: CANARY_TEXT, failedReports: 1 }, { failedSends: 1, who: { email: CANARY_TEXT } }]) {
      const r = run(REPORTS, reportsAnswer(over));
      expect(r.out, JSON.stringify(over)).not.toContain(CANARY_TEXT);
      expect(r.out, JSON.stringify(over)).not.toContain(CANARY_SECRET);
    }
  });

  it('a failed request still fails the job and prints no answer', () => {
    const r = run(REPORTS, reportsAnswer(), { FAKE_CURL_EXIT: '22' });
    expect(r.status).toBe(22);
    expect(r.out).not.toContain(CANARY_SECRET);
  });

  it('a missing secret fails before anything is called', () => {
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', runScriptOf(REPORTS)], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`, RUNNER_TEMP: work, SYNC_URL: '', CRON_SECRET: '' },
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('SYNC_URL or CRON_SECRET secret missing.');
  });
});

const WATCHER = 'sync-agent-wallets.yml';
const watcherAnswer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ ok: true, elapsed_ms: 987, tins: 3, wallets: 5, complete: 4, partial: 1, unavailable: 0, failed: 0, recorded: 12, truncated: false, ...over });

describe('Sync Agent Wallets goes red when a wallet could not be written or the run was cut short', () => {
  it('stays green for a clean run, and prints the numbers', () => {
    const r = run(WATCHER, watcherAnswer());
    expect(r.status).toBe(0);
    expect(r.out).toContain('"wallets":5');
    expect(r.out).not.toMatch(/problem/i);
  });

  it.each([
    ['a wallet whose ledger write failed', { failed: 1 }],
    ['a run the deadline cut short', { truncated: true }],
    ['an answer that is not ok', { ok: false }],
  ])('goes red for %s, after printing the numbers', (_name, over) => {
    const r = run(WATCHER, watcherAnswer(over));
    expect(r.status).toBe(1);
    expect(r.out).toContain('"wallets":5');
    expect(r.out).toMatch(/finished with a problem/);
  });

  it('a wallet the explorer could not answer for, or read part of the way, is picked up from its cursor tomorrow: not red', () => {
    expect(run(WATCHER, watcherAnswer({ unavailable: 3, partial: 2 })).status).toBe(0);
  });

  it('goes red for an answer that is not JSON at all', () => {
    expect(run(WATCHER, 'upstream connect error').status).toBe(1);
  });

  it('prints only numbers and true/false', () => {
    const r = run(WATCHER, watcherAnswer({ note: CANARY_TEXT, failed: 1 }));
    expect(r.out).not.toContain(CANARY_TEXT);
    expect(r.out).not.toContain(CANARY_SECRET);
  });
});

describe('both workflows send the secret in a header only', () => {
  it.each([
    [REPORTS, reportsAnswer(), '/api/cron/agent-reports'],
    [WATCHER, watcherAnswer(), '/api/cron/sync-agent-wallets'],
  ])('%s: the URL is the bare endpoint and the secret is in the x-cron-secret header, once', (file, answer, endpoint) => {
    const r = run(file, answer);
    expect(r.status).toBe(0);
    const args = r.args.filter(Boolean);
    expect(args).toContain(`https://app.example.test${endpoint}`); // no query string at all
    expect(args.filter((a) => a.includes('?'))).toEqual([]);
    expect(args.filter((a) => a.includes(CANARY_SECRET))).toEqual([`x-cron-secret: ${CANARY_SECRET}`]);
    expect(args.join('\n').split(CANARY_SECRET)).toHaveLength(2); // the secret appears exactly once among the arguments
    expect(r.out).not.toContain(CANARY_SECRET);
  });
});
