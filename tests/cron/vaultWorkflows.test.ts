import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The two Agent Vault workflows, run for real. Each one's `run:` script is taken out of the
 * workflow file and executed with bash the way GitHub does (`bash -eo pipefail`), with a fake
 * `curl` on the PATH that writes a chosen answer where the script asks for it (one line of answers
 * per call, the last repeated), and the real `jq`. No network. What is pinned:
 *
 *   - Agent Reports goes RED (exit 1) when the answer says a report or a send failed or the run was
 *     cut short, and when the answer is not JSON or not ok; it stays green otherwise;
 *   - Sync Agent Wallets calls again until the day's pass is done, then says so to the reports job;
 *     it goes RED when a call is not ok, when the pass is not done after its most calls, or when the
 *     finished pass counts a failed wallet: the whole pass is judged, not one call;
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
      'n=$(( $(cat "$RUNNER_TEMP/curl-count" 2>/dev/null || echo 0) + 1 ))',
      'echo "$n" > "$RUNNER_TEMP/curl-count"',
      'ans=$(printf "%s\\n" "$FAKE_ANSWER" | sed -n "${n}p")',
      '[ -z "$ans" ] && ans=$(printf "%s\\n" "$FAKE_ANSWER" | tail -n 1)',
      '[ -n "$out" ] && printf "%s" "$ans" > "$out"',
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
  rmSync(path.join(work, 'curl-count'), { force: true });
  writeFileSync(path.join(work, 'github-output'), '');
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
      GITHUB_OUTPUT: path.join(work, 'github-output'),
      ...env,
    },
  });
  const calls = Number(readFileSync(path.join(work, 'curl-count'), 'utf8').trim());
  const output = readFileSync(path.join(work, 'github-output'), 'utf8');
  return { status: r.status, out: `${r.stdout}${r.stderr}`, args: readFileSync(path.join(work, 'curl-args.txt'), 'utf8').split('\n'), calls, output };
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
  JSON.stringify({
    ok: true, elapsed_ms: 987, done: true, remaining: 0, tins: 3, wallets: 5, complete: 4, partial: 1, unavailable: 0, failed: 0, recorded: 12, truncated: false,
    pass_wallets: 5, pass_complete: 4, pass_partial: 1, pass_unavailable: 0, pass_failed: 0, pass_recorded: 12, ...over,
  });
/** The answers of a pass that takes `n` calls: n - 1 cut short with wallets left, then the last. */
const passOf = (n: number, last: Record<string, unknown> = {}) =>
  [...Array.from({ length: n - 1 }, (_, i) => watcherAnswer({ done: false, remaining: (n - 1 - i) * 10, truncated: true })), watcherAnswer(last)].join('\n');

describe('Sync Agent Wallets calls until the day\'s pass is done, and judges the whole pass', () => {
  it('a pass done in one call is one call, green, and tells the reports job it is done', () => {
    const r = run(WATCHER, watcherAnswer());
    expect(r.status).toBe(0);
    expect(r.calls).toBe(1);
    expect(r.out).toContain('"wallets":5');
    expect(r.out).toContain('"done":true');
    expect(r.out).not.toMatch(/problem/i);
    expect(r.output).toBe('done=true\n');
  });

  it('calls again while wallets are left: a call cut short is normal, not red', () => {
    const r = run(WATCHER, passOf(4));
    expect(r.status).toBe(0);
    expect(r.calls).toBe(4);
    expect(r.out.match(/"done":false/g)).toHaveLength(3);
    expect(r.output).toBe('done=true\n');
  });

  it('goes red when the finished pass counts a failed wallet, but still tells the reports job the pass is done', () => {
    const r = run(WATCHER, passOf(2, { pass_failed: 1 }));
    expect(r.status).toBe(1);
    expect(r.calls).toBe(2);
    expect(r.out).toMatch(/finished with a problem: failed wallets in the day's pass/);
    expect(r.output).toBe('done=true\n');
  });

  it('judges the pass, not the last call: a failed wallet earlier in the pass is red even when the last call read nothing', () => {
    const r = run(WATCHER, passOf(3, { wallets: 0, complete: 0, partial: 0, failed: 0, pass_failed: 2 }));
    expect(r.status).toBe(1);
  });

  it('a wallet the explorer could not answer for, or read part of the way, is picked up tomorrow: not red', () => {
    expect(run(WATCHER, watcherAnswer({ unavailable: 3, partial: 2, pass_unavailable: 3, pass_partial: 2 })).status).toBe(0);
  });

  it.each([
    ['not ok', watcherAnswer({ ok: false })],
    ['not JSON', 'upstream connect error'],
    ['empty', ''],
  ])('goes red at once for a call that answers %s, and never says the pass is done', (_name, bad) => {
    const r = run(WATCHER, [watcherAnswer({ done: false, remaining: 5 }), bad].join('\n'));
    expect(r.status).toBe(1);
    expect(r.calls).toBe(2);
    expect(r.out).toMatch(/call 2 did not answer ok/);
    expect(r.output).toBe('');
  });

  it('stops after its most calls when the pass never says done, red, and the reports do not run', () => {
    const r = run(WATCHER, watcherAnswer({ done: false, remaining: 3 }));
    expect(r.status).toBe(1);
    expect(r.calls).toBe(32);
    expect(r.out).toMatch(/stopped after 32 calls with wallets still to read/);
    expect(r.output).toBe('');
  });

  it('a failed request fails the job at once, and the reports do not run', () => {
    const r = run(WATCHER, watcherAnswer(), { FAKE_CURL_EXIT: '22' });
    expect(r.status).toBe(22);
    expect(r.calls).toBe(1);
    expect(r.output).toBe('');
  });

  it('prints only numbers and true/false', () => {
    const r = run(WATCHER, passOf(2, { note: CANARY_TEXT, pass_failed: 1 }));
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
