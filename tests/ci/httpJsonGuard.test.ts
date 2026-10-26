import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * API routes answer JSON through the one helper, src/lib/http.ts (Area 7). About 125 route files
 * each had their own json() and their headers drifted (some no-store, some pretty, some not).
 * This fails the day a file under src/pages defines a local json helper again
 * (`function json(` or `const json = (...) =>`): import { json } from '@/lib/http' instead and
 * pass { noStore, pretty, headers } for what the local copy did.
 *
 * ALLOWED lists files that cannot move yet, each with the reason. It is empty and only shrinks: an
 * entry whose file no longer defines a helper fails too, so remove it then.
 */

const ROOT = path.resolve(__dirname, '../..');
const PATTERN = /\bfunction\s+json\s*\(|\b(?:const|let|var)\s+json\s*=\s*(?:async\s+)?(?:function\b|\([^()]*\)\s*(?::[^=]*?)?=>|[A-Za-z_$][\w$]*\s*=>)/g;
const FIX = "import { json } from '@/lib/http' (options: noStore, pretty, headers)";

const ALLOWED: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(ts|tsx|astro|js|mjs)$/.test(name)) out.push(p);
	}
	return out;
}

const hits = new Map<string, string[]>();
for (const file of walk(path.join(ROOT, 'src/pages'))) {
	const rel = path.relative(ROOT, file).split(path.sep).join('/');
	const text = readFileSync(file, 'utf8');
	const found = [...text.matchAll(PATTERN)].map((m) => `line ${text.slice(0, m.index).split('\n').length}: ${m[0]}`);
	if (found.length) hits.set(rel, found);
}

describe('API routes use the one json() helper', () => {
	it('no file under src/pages defines its own json helper', () => {
		const strays = Object.fromEntries([...hits].filter(([f]) => !(f in ALLOWED)));
		expect(strays, FIX).toEqual({});
	});

	it('every allowlisted file still defines one, and has a reason', () => {
		for (const [file, reason] of Object.entries(ALLOWED)) {
			expect(hits.has(file), `${file} no longer defines a json helper: remove it from ALLOWED`).toBe(true);
			expect(reason.length).toBeGreaterThan(20);
		}
	});

	it('the shared helper is where the rule points', () => {
		const text = readFileSync(path.join(ROOT, 'src/lib/http.ts'), 'utf8');
		expect(text).toMatch(/export function json\(body: unknown, status = 200, options: JsonOptions = \{\}\): Response/);
	});

	it('the pattern finds local helpers and leaves parsed responses alone', () => {
		const sample = [
			'function json(body: unknown, status = 200) {',
			'const json = (body: unknown, status = 200) =>',
			'const json = (body: unknown, status: number): Response =>',
			'const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>',
			'let json = function (body) {',
			'const json = body => new Response(JSON.stringify(body))',
			'const json = await res.json();',
			'const json = (await res.json()) as { result?: string };',
			"import { json } from '@/lib/http';",
			'return json({ ok: true }, 200, { noStore: true });',
		];
		expect(sample.map((line) => new RegExp(PATTERN.source).test(line))).toEqual([
			true, true, true, true, true, true, false, false, false, false,
		]);
	});
});
