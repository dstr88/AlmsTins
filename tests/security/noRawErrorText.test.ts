import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * API responses must not carry raw error text. On 2026-10-10 /api/research/needs-attention
 * returned a database error, user name included, to a demo visitor ("password
 * authentication failed for user ..."), and anyone can start a demo. Errors are logged on
 * the server; the response says something plain.
 *
 * Flags `error: String(err)`, `error: err.message`, `error: err instanceof Error ? ...`
 * (and the same for message/detail) unless it is inside a console call. Cron routes are
 * left out (secret-gated; their workflows print numbers and booleans only), and
 * debug/health, which is owner-only.
 */

const API = path.resolve(__dirname, '../../src/pages/api');
const SKIP = [/^cron\//, /^debug\/health\.ts$/];
// An object key (start of line, or after "{" or ","), not `err.message : ...` in a ternary.
const RAW = /(?:^\s*|[{,]\s*)(error|message|detail)\s*:\s*(String\(\s*(e|err|error)\s*\)|(e|err|error)\.message\b|(e|err|error)\s+instanceof\s+Error\s*\?)/;

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(ts|js)$/.test(name)) out.push(p);
	}
	return out;
}

function offenders(): string[] {
	const found: string[] = [];
	for (const file of walk(API)) {
		const rel = path.relative(API, file).split(path.sep).join('/');
		if (SKIP.some((re) => re.test(rel))) continue;
		const lines = readFileSync(file, 'utf8').split('\n');
		lines.forEach((line, i) => {
			if (!RAW.test(line)) return;
			// Inside a console.* call (possibly opened a few lines up): a log, not a response.
			const context = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
			if (/console\.(error|warn|log|info)\(/.test(context) && !/new Response|json\(|respond\(/.test(lines.slice(Math.max(0, i - 2), i + 1).join('\n'))) return;
			found.push(`${rel}:${i + 1}: ${line.trim()}`);
		});
	}
	return found;
}

describe('API responses carry no raw error text', () => {
	it('finds none outside logs, cron routes and the owner-only health check', () => {
		expect(offenders()).toEqual([]);
	});
});

describe('owner-only diagnostics', () => {
	it.each(['debug/health.ts', 'analytics.json.ts'])('%s answers only the owner', (rel) => {
		const src = readFileSync(path.join(API, rel), 'utf8');
		expect(src).toMatch(/if \(!session \|\| !isOwner\(session\.tenantId\)\) return new Response\('Not found', \{ status: 404 \}\);/);
	});
});
