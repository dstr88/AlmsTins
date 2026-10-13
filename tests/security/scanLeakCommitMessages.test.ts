import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * scripts/scan-leak.sh is the pre-push leak gate. It used to scan only the added lines, so a
 * private name in a COMMIT MESSAGE or an annotated TAG MESSAGE went out unnoticed, and file
 * content was skipped when the remote sha was not in the local clone. These tests run the
 * real script in a throwaway repo with synthetic patterns (no real names, no network) and
 * prove each of those blocks the push, with the matched text redacted.
 */
const SCRIPT = resolve(__dirname, '../../scripts/scan-leak.sh');
const Z = '0'.repeat(40);
const SYNTHETIC_NAME = 'Zorblax Quimby';

// Keep the user's or runner's git config and any hook-time GIT_* variables out of the repo.
const env: NodeJS.ProcessEnv = Object.fromEntries(
	Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
);
Object.assign(env, {
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_AUTHOR_NAME: 'test',
	GIT_AUTHOR_EMAIL: 'test@example.invalid',
	GIT_COMMITTER_NAME: 'test',
	GIT_COMMITTER_EMAIL: 'test@example.invalid',
});

let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
const commit = (...messageParts: string[]) => {
	git('commit', '-q', '--allow-empty', ...messageParts.flatMap((m) => ['-m', m]));
	return git('rev-parse', 'HEAD');
};
const prePush = (lsha: string, rsha: string, ref = 'refs/heads/feat') => {
	const r = spawnSync('bash', [join(repo, 'scripts/scan-leak.sh')], {
		cwd: repo,
		env,
		encoding: 'utf8',
		input: `${ref} ${lsha} ${ref} ${rsha}\n`,
	});
	return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
// A remote sha this clone has never seen, as after the remote branch moved without a fetch.
const UNKNOWN_SHA = 'ab'.repeat(20);
const writePatterns = (extra = '') =>
	writeFileSync(join(repo, '.scan-patterns'), `${SYNTHETIC_NAME}\nacct-[0-9]{6}\tacct-123456\n${extra}`);

beforeAll(() => {
	repo = mkdtempSync(join(tmpdir(), 'scan-leak-'));
	git('-c', 'init.defaultBranch=main', 'init', '-q');
	mkdirSync(join(repo, 'scripts'));
	copyFileSync(SCRIPT, join(repo, 'scripts/scan-leak.sh'));
	writeFileSync(join(repo, '.gitignore'), '.scan-patterns\n');
	writeFileSync(join(repo, 'a.txt'), 'hello\n');
	writePatterns();
	git('add', '-A');
	commit('base');
	// History already on the remote, with the name in a message: not this push's to block.
	const published = commit(`old note about ${SYNTHETIC_NAME}`);
	git('update-ref', 'refs/remotes/origin/main', published);
	git('checkout', '-q', '-b', 'feat');
});

afterAll(() => {
	if (repo) rmSync(repo, { recursive: true, force: true });
});

describe('scan-leak.sh: commit messages being pushed', () => {
	it('passes a new branch whose own commits are clean, ignoring already-pushed history', () => {
		const head = commit('a clean change');
		const r = prePush(head, Z);
		expect(r.out).toContain('leak-scan: clean');
		expect(r.code).toBe(0);
	});

	it('blocks a new branch when a pushed commit message holds a pattern, and redacts it', () => {
		const head = commit(`fix for ${SYNTHETIC_NAME.toUpperCase()}'s account`);
		const r = prePush(head, Z);
		expect(r.code).toBe(1);
		expect(r.out).toContain('BLOCKED');
		expect(r.out).toContain(`commit ${head.slice(0, 12)} message [match redacted]`);
		expect(r.out.toLowerCase()).not.toContain(SYNTHETIC_NAME.toLowerCase());
		git('reset', '-q', '--hard', 'HEAD~1');
	});

	it('blocks an update push when a regex pattern is in the message body (rsha..lsha)', () => {
		const remote = git('rev-parse', 'HEAD');
		const head = commit('subject', 'the body mentions acct-987654');
		const r = prePush(head, remote);
		expect(r.code).toBe(1);
		expect(r.out).toContain(`commit ${head.slice(0, 12)} message [match redacted]`);
		expect(r.out).not.toContain('acct-987654');
		git('reset', '-q', '--hard', 'HEAD~1');
	});

	it('falls back to commits no remote has when the remote sha is unknown here', () => {
		const head = commit(`again ${SYNTHETIC_NAME}`);
		const r = prePush(head, '1234567890'.repeat(4));
		expect(r.code).toBe(1);
		expect(r.out).toContain('BLOCKED');
		git('reset', '-q', '--hard', 'HEAD~1');
	});

	it('fails closed when a pattern cannot be caught in a commit message (canary self-test)', () => {
		writePatterns('^qqq-[0-9]+\tqqq-1\n');
		try {
			const r = prePush(git('rev-parse', 'HEAD'), Z);
			expect(r.code).toBe(1);
			expect(r.out).toContain('failed its canary self-test');
			expect(r.out).toContain('is not caught in a tag message');
		} finally {
			writePatterns();
		}
	});
});

describe('scan-leak.sh: file content when the remote sha is unknown here', () => {
	it('blocks a pattern in an added file when this clone lacks the remote sha', () => {
		const base = git('rev-parse', 'HEAD');
		writeFileSync(join(repo, 'note.txt'), `owner: ${SYNTHETIC_NAME}\n`);
		git('add', 'note.txt');
		const head = commit('a clean message');
		try {
			const r = prePush(head, UNKNOWN_SHA);
			expect(r.code).toBe(1);
			expect(r.out).toContain('BLOCKED');
			expect(r.out).toContain('note.txt [match redacted]');
			expect(r.out.toLowerCase()).not.toContain(SYNTHETIC_NAME.toLowerCase());
		} finally {
			git('reset', '-q', '--hard', base);
		}
	});

	it('still passes a clean branch when this clone lacks the remote sha', () => {
		const r = prePush(git('rev-parse', 'HEAD'), UNKNOWN_SHA);
		expect(r.out).toContain('leak-scan: clean');
		expect(r.code).toBe(0);
	});

	it('fails closed when the pushed sha cannot be read', () => {
		const r = prePush(UNKNOWN_SHA, Z);
		expect(r.code).toBe(1);
		expect(r.out).toContain('fail-closed');
	});
});

describe('scan-leak.sh: annotated tags being pushed', () => {
	const tagSha = (name: string) => git('rev-parse', `refs/tags/${name}`);

	it('passes a clean annotated tag', () => {
		git('tag', '-a', 'v-clean', '-m', 'release notes');
		try {
			const r = prePush(tagSha('v-clean'), Z, 'refs/tags/v-clean');
			expect(r.out).toContain('leak-scan: clean');
			expect(r.code).toBe(0);
		} finally {
			git('tag', '-d', 'v-clean');
		}
	});

	it('blocks a pattern in the tag message, new tag or update, and redacts it', () => {
		const head = git('rev-parse', 'HEAD');
		git('tag', '-a', 'v-leak', '-m', 'release', '-m', `thanks to ${SYNTHETIC_NAME}`);
		const tag = tagSha('v-leak');
		try {
			for (const rsha of [Z, head]) {
				const r = prePush(tag, rsha, 'refs/tags/v-leak');
				expect(r.code).toBe(1);
				expect(r.out).toContain(`tag ${tag.slice(0, 12)} message [match redacted]`);
				expect(r.out.toLowerCase()).not.toContain(SYNTHETIC_NAME.toLowerCase());
			}
		} finally {
			git('tag', '-d', 'v-leak');
		}
	});

	it('blocks a pattern in the tag name or in an inner tag of a tag', () => {
		git('tag', '-a', 'acct-246810', '-m', 'clean');
		git('tag', '-a', 'v-inner', '-m', `for ${SYNTHETIC_NAME}`);
		git('-c', 'advice.nestedTag=false', 'tag', '-a', 'v-outer', tagSha('v-inner'), '-m', 'clean outer');
		try {
			const named = prePush(tagSha('acct-246810'), Z, 'refs/tags/acct-246810');
			expect(named.code).toBe(1);
			expect(named.out).not.toContain('acct-246810');

			const inner = tagSha('v-inner');
			const nested = prePush(tagSha('v-outer'), Z, 'refs/tags/v-outer');
			expect(nested.code).toBe(1);
			expect(nested.out).toContain(`tag ${inner.slice(0, 12)} message [match redacted]`);
		} finally {
			git('tag', '-d', 'acct-246810', 'v-inner', 'v-outer');
		}
	});
});
