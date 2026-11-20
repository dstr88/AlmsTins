import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The red outline on the admin page's Recent users list: an account that signed up and never
 * came back (src/lib/personRecords.ts).
 *
 * It used to judge "came back" by the last sign-in alone. A session lasts 30 days, so a person
 * who returned every day without signing in again was outlined as gone. The rule now also reads
 * the last active day: an account active on a day later than the day it signed up has returned.
 *
 * Pinned here: the rule's four parts, that the page takes it from src/lib, and that a failed
 * check only drops the outline and is logged.
 */
const mem = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], fail: false, statements: [] as string[] }));

vi.mock('@/lib/db', () => ({
	db: {
		execute: async (stmt: any) => {
			const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ').trim();
			mem.statements.push(sql);
			if (sql.startsWith('SELECT column_name FROM information_schema.columns')) {
				return { rows: [{ column_name: 'signup_service' }, { column_name: 'last_active_on' }], rowsAffected: 0 };
			}
			if (mem.fail) throw new Error('relation "cairn_invites" does not exist');
			return { rows: mem.rows, rowsAffected: 0 };
		},
		batch: async () => { throw new Error('batch not expected'); },
	},
}));

import { ABANDONED_ACCOUNTS_SQL, PERSON_RECORD_TABLES, listAbandonedAccountIds } from '../../src/lib/personRecords';
import { __resetAccountActivityForTests } from '../../src/lib/accountActivity';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
const sql = ABANDONED_ACCOUNTS_SQL.replace(/\s+/g, ' ');

beforeEach(() => {
	mem.rows = [];
	mem.fail = false;
	mem.statements = [];
	__resetAccountActivityForTests();
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('the rule', () => {
	it('only an account with a known sign-up time can be marked', () => {
		expect(sql).toContain('WHERE u.created_at IS NOT NULL');
	});

	it('no sign-in more than an hour after the account was made', () => {
		expect(sql).toContain("AND (u.last_login IS NULL OR u.last_login::timestamp <= u.created_at::timestamp + interval '1 hour')");
	});

	it('and no active day later than the sign-up day: a visit on a live session counts as coming back', () => {
		expect(sql).toContain("AND (u.last_active_on IS NULL OR u.last_active_on <= to_char(u.created_at::timestamp, 'YYYY-MM-DD'))");
	});

	it('and none of the records a person makes, and no invite accepted', () => {
		for (const table of PERSON_RECORD_TABLES) expect(sql).toContain(`EXISTS (SELECT 1 FROM ${table} x WHERE x.tenant_id IN (`);
		expect(sql).toContain('AND NOT EXISTS (SELECT 1 FROM receivable_invites ri WHERE ri.accepted_by = u.id)');
		expect(sql).toContain('AND NOT EXISTS (SELECT 1 FROM cairn_invites ci WHERE ci.accepted_by = u.id)');
	});
});

describe('the check', () => {
	it('returns the ids the page outlines', async () => {
		mem.rows = [{ id: 'u-gone' }, { id: 'u-gone-too' }];
		expect(await listAbandonedAccountIds()).toEqual(new Set(['u-gone', 'u-gone-too']));
	});

	it('a failure only drops the outline, and is logged', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mem.fail = true;
		expect(await listAbandonedAccountIds()).toEqual(new Set());
		expect(warn).toHaveBeenCalledWith('[admin] abandoned-account check failed', 'relation "cairn_invites" does not exist');
	});
});

describe('the page', () => {
	const page = read('src/pages/admin/index.astro');

	it('takes the rule from src/lib and no longer defines the table list itself', () => {
		expect(page).toContain("import { listAbandonedAccountIds } from '@/lib/personRecords';");
		expect(page).toContain('const abandonedIds = await listAbandonedAccountIds();');
		expect(page).not.toContain('PERSON_RECORD_TABLES');
		expect(page).not.toContain("'wallets', 'transactions'");
	});

	it('outlines the last login with a class from the shared stylesheet, not an inline style', () => {
		expect(page).toContain("<span class:list={[{ 'adm-abandoned': abandonedIds.has(String(u.id)) }]}>");
		expect(page).not.toContain('border:1.5px solid #d33');
		expect(read('src/components/admin/adminSection.css')).toMatch(/\.adm-abandoned \{\s*border: 1\.5px solid #d33;/);
	});

	it('says what the outline means', () => {
		expect(page).toContain('A red outline marks an account that signed up, never came back on a later day, and has no wallets, imports, documents or other records.');
	});
});
