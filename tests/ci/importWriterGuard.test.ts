import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Imported rows are written in one place: src/lib/importRows.ts (insertImportBatch). Copies of its
 * INSERTs drifted and named columns the tables do not have, which broke the Bitcoin, Solana and
 * both Avalanche importers in production. This fails the day someone writes import_raw_rows or
 * import_transactions with their own INSERT instead of handing rows to the shared writer.
 *
 * ALLOWED lists the writers that cannot move, each with the reason. It only shrinks: an entry
 * whose file no longer has such an INSERT fails too, so remove it then.
 */

const ROOT = path.resolve(__dirname, '../..');
const WRITER = 'src/lib/importRows.ts';
const INSERT = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["`]?(import_raw_rows|import_transactions)\b/gi;

const ALLOWED: Record<string, string> = {
	'src/pages/api/wallets/[id]/token-basis.ts':
		'an upsert, not an import: re-submitting a manual cost basis for the same day replaces its date and ' +
		'price (ON CONFLICT(id) DO UPDATE). The shared writer only adds new rows, so the edit would stop saving.',
};

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(ts|tsx|astro|mjs|js)$/.test(name)) out.push(p);
	}
	return out;
}

const writers = new Map<string, string[]>();
for (const file of walk(path.join(ROOT, 'src'))) {
	const rel = path.relative(ROOT, file).split(path.sep).join('/');
	const tables = [...readFileSync(file, 'utf8').matchAll(INSERT)].map((m) => m[1].toLowerCase());
	if (tables.length) writers.set(rel, tables);
}

describe('imported rows are written only by src/lib/importRows.ts', () => {
	it('no other file inserts into import_raw_rows or import_transactions', () => {
		const strays = [...writers.keys()].filter((f) => f !== WRITER && !(f in ALLOWED));
		expect(strays, 'hand the rows to insertImportBatch() in src/lib/importRows.ts').toEqual([]);
	});

	it('the shared writer has both inserts', () => {
		expect([...new Set(writers.get(WRITER))].sort()).toEqual(['import_raw_rows', 'import_transactions']);
	});

	it('every allowlisted file still has its own insert, and a reason', () => {
		for (const [file, reason] of Object.entries(ALLOWED)) {
			expect(writers.has(file), `${file} no longer writes imported rows: remove it from ALLOWED`).toBe(true);
			expect(reason.length).toBeGreaterThan(20);
		}
	});
});
