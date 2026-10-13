import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * scripts/cron-curl.sh is the curl wrapper every scheduled workflow uses to call its
 * /api/cron/* endpoint. It may retry ONLY when the request never reached the server (curl exit
 * 6, could not resolve host; exit 7, failed to connect). An HTTP error (exit 22) or a timeout
 * (exit 28) may mean the endpoint already did part of its work, such as sending drip or digest
 * emails, so resending could repeat it.
 *
 * These tests run the real script against a fake `curl` placed first on PATH. The fake records
 * each call's arguments and exits with the next code from FAKE_CURL_CODES. No network.
 */
const SCRIPT = resolve(__dirname, '../../scripts/cron-curl.sh');
const WORKFLOWS = resolve(__dirname, '../../.github/workflows');
const CANARY_SECRET = 'cron-secret-canary-7f3a';
const URL_WITH_SECRET = `https://cron.example.invalid/api/cron/onboarding-drip?secret=${CANARY_SECRET}`;
const BASE_ARGS = [
	'-sS',
	'--fail',
	'--max-time',
	'300',
	'-o',
	'/dev/null',
	'-w',
	'HTTP %{http_code}\\n',
	URL_WITH_SECRET,
	'-H',
	`x-cron-secret: ${CANARY_SECRET}`,
];

let binDir: string;
let callDir: string;

beforeAll(() => {
	binDir = mkdtempSync(join(tmpdir(), 'cron-curl-bin-'));
	// Exits with the Nth code of FAKE_CURL_CODES on its Nth call (0 when the list runs out) and
	// writes that call's arguments, one per line, to $FAKE_CURL_CALLS/<N>.
	writeFileSync(
		join(binDir, 'curl'),
		[
			'#!/bin/sh',
			'n=$(ls "$FAKE_CURL_CALLS" | wc -l | tr -d " ")',
			'n=$((n + 1))',
			'printf "%s\\n" "$@" > "$FAKE_CURL_CALLS/$n"',
			'code=$(echo "$FAKE_CURL_CODES" | cut -d" " -f"$n")',
			'[ -z "$code" ] && code=0',
			'[ "$code" = 0 ] && echo "HTTP 200"',
			'exit "$code"',
			'',
		].join('\n'),
	);
	chmodSync(join(binDir, 'curl'), 0o755);
});

afterAll(() => {
	rmSync(binDir, { recursive: true, force: true });
});

beforeEach(() => {
	callDir = mkdtempSync(join(tmpdir(), 'cron-curl-calls-'));
	return () => rmSync(callDir, { recursive: true, force: true });
});

function run(codes: number[], args: string[] = BASE_ARGS) {
	const r = spawnSync('bash', [SCRIPT, ...args], {
		encoding: 'utf8',
		env: {
			PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
			FAKE_CURL_CODES: codes.join(' '),
			FAKE_CURL_CALLS: callDir,
			CRON_CURL_RETRY_DELAY: '0',
		},
	});
	const calls = existsSync(callDir)
		? readdirSync(callDir)
				.sort((a, b) => Number(a) - Number(b))
				.map((f) => readFileSync(join(callDir, f), 'utf8').replace(/\n$/, '').split('\n'))
		: [];
	return { code: r.status, stdout: r.stdout, stderr: r.stderr, calls };
}

describe('cron-curl.sh retries only when the request never reached the server', () => {
	it('passes a first-try success straight through, with the arguments unchanged', () => {
		const r = run([0]);
		expect(r.code).toBe(0);
		expect(r.calls).toEqual([BASE_ARGS]);
		expect(r.stdout).toBe('HTTP 200\n');
		expect(r.stderr).toBe('');
	});

	it('retries after curl exit 6 (could not resolve host)', () => {
		const r = run([6, 0]);
		expect(r.code).toBe(0);
		expect(r.calls).toEqual([BASE_ARGS, BASE_ARGS]);
		expect(r.stderr).toContain('attempt 1 of 3');
	});

	it('retries after curl exit 7 (failed to connect)', () => {
		const r = run([7, 7, 0]);
		expect(r.code).toBe(0);
		expect(r.calls).toHaveLength(3);
		expect(r.stderr).toContain('attempt 2 of 3');
	});

	it('stops after 3 attempts and fails with the last curl status', () => {
		const r = run([7, 6, 7, 0]);
		expect(r.code).toBe(7);
		expect(r.calls).toHaveLength(3);
		expect(r.stderr).toContain('after 3 attempts');
	});

	it('does not retry an HTTP error (exit 22): the endpoint may have done part of its work', () => {
		const r = run([22, 0]);
		expect(r.code).toBe(22);
		expect(r.calls).toHaveLength(1);
	});

	it('does not retry a timeout (exit 28): the endpoint may still be running', () => {
		const r = run([28, 0]);
		expect(r.code).toBe(28);
		expect(r.calls).toHaveLength(1);
	});

	it('does not retry an HTTP error that follows a connect retry', () => {
		const r = run([6, 22, 0]);
		expect(r.code).toBe(22);
		expect(r.calls).toHaveLength(2);
	});

	it.each([35, 52, 56, 1])('does not retry any other curl failure (exit %i)', (code) => {
		const r = run([code, 0]);
		expect(r.code).toBe(code);
		expect(r.calls).toHaveLength(1);
	});

	it('never prints the URL or the secret, even while retrying and giving up', () => {
		const r = run([6, 7, 6]);
		expect(`${r.stdout}${r.stderr}`).not.toContain(CANARY_SECRET);
		expect(`${r.stdout}${r.stderr}`).not.toContain('example.invalid');
	});
});

describe('cron-curl.sh refuses unsafe calls without running curl', () => {
	it('requires --max-time', () => {
		const r = run([0], BASE_ARGS.filter((a, i) => a !== '--max-time' && BASE_ARGS[i - 1] !== '--max-time'));
		expect(r.code).toBe(2);
		expect(r.calls).toHaveLength(0);
	});

	it('requires --fail', () => {
		const r = run([0], BASE_ARGS.filter((a) => a !== '--fail'));
		expect(r.code).toBe(2);
		expect(r.calls).toHaveLength(0);
	});

	it.each([['--retry', '4'], ['--retry-all-errors'], ['--retry-connrefused']])('rejects curl %s', (...flag) => {
		const r = run([0], [...flag, ...BASE_ARGS]);
		expect(r.code).toBe(2);
		expect(r.calls).toHaveLength(0);
		expect(r.stderr).not.toContain(CANARY_SECRET);
	});

	it('rejects an empty call', () => {
		const r = run([0], []);
		expect(r.code).toBe(2);
		expect(r.calls).toHaveLength(0);
	});
});

describe('cron-curl.sh source', () => {
	const src = readFileSync(SCRIPT, 'utf8');

	it('keeps strict mode and never traces its arguments', () => {
		expect(src).toMatch(/^set -euo pipefail$/m);
		expect(src).not.toMatch(/^\s*set -[a-z]*x/m);
		expect(src).not.toMatch(/echo[^\n]*"\$[@*]"/);
	});
});

// ─── Source pin: every cron workflow goes through the wrapper ───────────────────────────────

const cronWorkflows = readdirSync(WORKFLOWS)
	.filter((f) => /\.ya?ml$/.test(f))
	.map((f) => ({ file: f, text: readFileSync(join(WORKFLOWS, f), 'utf8') }))
	.filter(({ text }) => text.includes('/api/cron/'));

/** The workflow's non-comment lines, with shell line continuations joined. */
const code = (text: string) =>
	text
		.split('\n')
		.filter((l) => !/^\s*#/.test(l))
		.join('\n')
		.replace(/\\\n\s*/g, ' ');

describe('every workflow that calls an app endpoint uses cron-curl.sh', () => {
	it('finds the cron workflows', () => {
		expect(cronWorkflows.length).toBeGreaterThanOrEqual(16);
	});

	it.each(cronWorkflows.map((w) => [w.file, w.text]))('%s calls the endpoint through the wrapper', (_f, text) => {
		const body = code(text);
		const calls = body.match(/bash scripts\/cron-curl\.sh [^\n]*/g) ?? [];
		expect(calls).toHaveLength(1);
		// No bare curl call that would skip the retry policy.
		expect(body).not.toMatch(/(^|[\s;&|(])curl\s/m);
		expect(calls[0]).toMatch(/\/api\/cron\//);
	});

	it.each(cronWorkflows.map((w) => [w.file, w.text]))('%s sets --fail and a --max-time, and no curl retry flags', (_f, text) => {
		const call = (code(text).match(/bash scripts\/cron-curl\.sh [^\n]*/) ?? [''])[0];
		expect(call).toMatch(/\s--fail\s/);
		const maxTime = call.match(/\s--max-time\s+(\d+)\s/);
		expect(maxTime).not.toBeNull();
		expect(Number(maxTime![1])).toBeGreaterThan(0);
		expect(text).not.toContain('--retry');
	});

	it.each(cronWorkflows.map((w) => [w.file, w.text]))('%s checks out only the wrapper, read-only', (_f, text) => {
		expect(text).toMatch(/uses: actions\/checkout@v4\n\s+with:\n(\s+[a-z-]+: [^\n]+\n)*?\s+sparse-checkout: scripts\/cron-curl\.sh\n/);
		expect(text).toMatch(/sparse-checkout-cone-mode: false/);
		expect(text).toMatch(/persist-credentials: false/);
		expect(text).toMatch(/^permissions:\n\s+contents: read$/m);
	});
});
