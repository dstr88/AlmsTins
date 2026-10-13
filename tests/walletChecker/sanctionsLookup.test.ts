import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * lookupSanctionedAddress answers true (on the OFAC list), false (looked up, not on it) or
 * null (NOT CHECKED). Before the 2026-10-11 code review a database error, or a mirror with no
 * OFAC rows yet, came back as a plain false, so the checker showed "no sanctions match" for
 * a check that never ran.
 *
 * The db client is stubbed (no Postgres): each test sets what it answers.
 */

type Mode = 'down' | 'empty' | 'domains-only' | 'loaded';
const db = vi.hoisted(() => ({ mode: 'loaded' as string, sanctioned: new Set<string>(), queries: [] as string[] }));

vi.mock('@/lib/db', () => ({
	db: {
		execute: async ({ sql, args }: { sql: string; args?: unknown[] }) => {
			db.queries.push(sql);
			if (db.mode === 'down') throw new Error('password authentication failed for user "x"');
			if (/^\s*CREATE/i.test(sql)) return { rows: [] };
			if (/kind = 'sanctioned' LIMIT 1/.test(sql)) {
				return { rows: db.mode === 'loaded' ? [{ '?column?': 1 }] : [] };
			}
			if (/FROM threat_entries LIMIT 1/.test(sql)) {
				return { rows: db.mode === 'empty' ? [] : [{ '?column?': 1 }] };
			}
			if (/kind = 'sanctioned' AND value IN/.test(sql)) {
				const [exact, lower] = (args ?? []) as string[];
				return { rows: db.sanctioned.has(exact) || db.sanctioned.has(lower) ? [{ '?column?': 1 }] : [] };
			}
			throw new Error(`unexpected query: ${sql}`);
		},
		batch: async () => [],
	},
}));

const EVM_ON_LIST = '0x8589427373d6d84e98730d7795d8f6f8731fda16';
const EVM_CLEAN   = '0x1111111111111111111111111111111111111111';

async function freshLookup(mode: Mode) {
	db.mode = mode;
	vi.resetModules();
	const { lookupSanctionedAddress } = await import('../../src/lib/threatLists');
	return lookupSanctionedAddress;
}

beforeEach(() => {
	db.sanctioned = new Set([EVM_ON_LIST]);
	db.queries = [];
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('lookupSanctionedAddress', () => {
	it('on the list → true (EVM matched lowercased)', async () => {
		const lookup = await freshLookup('loaded');
		expect(await lookup(EVM_ON_LIST.toUpperCase().replace('0X', '0x'))).toBe(true);
	});

	it('looked up and not on the list → false', async () => {
		const lookup = await freshLookup('loaded');
		expect(await lookup(EVM_CLEAN)).toBe(false);
	});

	it('database unreachable → null (not checked), never false', async () => {
		const lookup = await freshLookup('down');
		expect(await lookup(EVM_ON_LIST)).toBeNull();
	});

	it('mirror has no rows at all → null', async () => {
		const lookup = await freshLookup('empty');
		expect(await lookup(EVM_ON_LIST)).toBeNull();
	});

	it('domain lists loaded but no OFAC rows yet → null (the domain lists say nothing about sanctions)', async () => {
		const lookup = await freshLookup('domains-only');
		expect(await lookup(EVM_ON_LIST)).toBeNull();
		expect(db.queries.some((q) => /kind = 'sanctioned' AND value IN/.test(q))).toBe(false);
	});

	it('never throws', async () => {
		const lookup = await freshLookup('down');
		await expect(lookup(EVM_CLEAN)).resolves.toBeNull();
	});
});
