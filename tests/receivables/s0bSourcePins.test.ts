import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Source pins for the files the receivables S0b slice adds (S0a's pins keep covering its own):
 *   - anchorSpec.ts is import-free and schema.ts stays import-free;
 *   - modules under src/lib/receivables/ outside server/ never import the database or a server
 *     module; anchorNow.ts, which reaches the database, lives in server/;
 *   - no new file mentions the private product (the cairn pin);
 *   - every OpenTimestamps stamp in the receivables routes goes through anchorNow or the anchor
 *     route, so there is one stamping path to rate-limit and keep fail-soft.
 */

const read = (rel: string) => fs.readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const importsOf = (src: string) => [...src.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);

const NEW_FILES = [
	'src/lib/recordProof/isoSign.ts',
	'src/lib/rwaProof/recordSet.ts',
	'src/lib/receivables/anchorSpec.ts',
	'src/lib/receivables/server/anchorNow.ts',
	'tests/recordProof/isoSign.test.ts',
	'tests/recordProof/publishedKeys.test.ts',
	'tests/recordProof/s0bSigningCharacterization.test.ts',
	'tests/receivables/anchorNow.test.ts',
	'tests/receivables/anchorRoutesCharacterization.test.ts',
	'tests/receivables/evidenceCharacterization.test.ts',
	'tests/receivables/evidencePlumbing.test.ts',
	'tests/receivables/evidenceRoutes.test.ts',
];

describe('S0b source pins', () => {
	it('anchorSpec.ts and schema.ts import nothing', () => {
		for (const f of ['src/lib/receivables/anchorSpec.ts', 'src/lib/receivables/schema.ts']) expect(importsOf(read(f)), f).toEqual([]);
	});

	it('anchorNow.ts is a server module', () => {
		expect(fs.existsSync(fileURLToPath(new URL('../../src/lib/receivables/server/anchorNow.ts', import.meta.url)))).toBe(true);
		expect(importsOf(read('src/lib/receivables/server/anchorNow.ts'))).toContain('@/lib/receivablesRegistry');
	});

	it('no new file mentions the private product', () => {
		for (const f of NEW_FILES) expect(read(f), f).not.toMatch(/cairn|milestone/i);
		expect(read('src/lib/receivables/schema.ts')).not.toMatch(/cairn|milestone/i);
	});

	it('the receivables routes stamp only through anchorNow (or the page-driven anchor route)', () => {
		const dir = fileURLToPath(new URL('../../src/pages/api/verify/receivables/', import.meta.url));
		const stampers = fs.readdirSync(dir)
			.filter((f) => f.endsWith('.ts'))
			.filter((f) => /OpenTimestampsAnchor/.test(fs.readFileSync(`${dir}${f}`, 'utf8')));
		expect(stampers).toEqual(['anchor.ts']);
	});
});
