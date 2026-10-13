import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RECEIVABLES_HOSTS, hostPath, type ReceivablesHost } from '../helpers/receivablesHosts';

/**
 * Source pins for the files S0a adds. S1's componentSplit.test.ts takes these over for every
 * receivables file; until then they hold the plan's conventions for the new modules:
 *   - pure modules under src/lib/receivables/ never import the database or a server/ module,
 *     so they stay safe to bundle into a page script;
 *   - attestationClass.ts, schema.ts and the copy modules are import-free;
 *   - no new file mentions the private product (the cairn pin);
 *   - every host page in tests/helpers/receivablesHosts.ts exists, so a file move that misses
 *     the list fails here first.
 */

const read = (rel: string) => fs.readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const importsOf = (src: string) => [...src.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);

const COPY = ['src/lib/receivables/copy/attest.ts'];
const PURE = ['src/lib/receivables/attestationClass.ts', 'src/lib/receivables/status.ts', 'src/lib/receivables/schema.ts', ...COPY];
const NEW_FILES = [
	...PURE,
	'src/lib/http/publicApi.ts',
	'tests/helpers/receivablesDbFake.ts',
	'tests/helpers/receivablesHosts.ts',
	'tests/helpers/brightLineWording.ts',
];

describe('S0a source pins', () => {
	it('pure receivables modules stay client-safe', () => {
		for (const f of PURE) {
			for (const i of importsOf(read(f))) {
				expect(i, `${f} imports ${i}`).not.toMatch(/(^@\/lib\/db$|\/server\/|^node:|^crypto$)/);
				expect(i.startsWith('./') || i.startsWith('@/lib/receivables/'), `${f} imports ${i}`).toBe(true);
			}
		}
	});

	it('attestationClass.ts, schema.ts and the copy modules import nothing', () => {
		for (const f of ['src/lib/receivables/attestationClass.ts', 'src/lib/receivables/schema.ts', ...COPY]) {
			expect(importsOf(read(f)), f).toEqual([]);
		}
	});

	it('no new file mentions the private product', () => {
		for (const f of NEW_FILES) expect(read(f), f).not.toMatch(/cairn|milestone/i);
	});

	it('every receivables host page exists where the host list says', () => {
		for (const host of Object.keys(RECEIVABLES_HOSTS) as ReceivablesHost[]) {
			expect(fs.existsSync(hostPath(host)), RECEIVABLES_HOSTS[host]).toBe(true);
		}
	});
});
