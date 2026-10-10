import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { TENANT_TABLES, USER_TABLES } from '../../src/lib/accountDeleteTables';

/**
 * Deleting an account removes all of its data except the financing-desk records other
 * parties rely on (privacy policy v1.2, sections 11 and 16). The list of tables lives in
 * src/lib/accountDeleteTables.ts; this fails when any table that holds per-account data
 * (a tenant_id column, or a user_id column for per-user tables) is defined anywhere in the
 * code, or classified per-tenant in the RLS plan, but is neither deleted nor deliberately
 * kept below with a reason.
 */

const ROOT = path.resolve(__dirname, '../..');

/** Deliberately kept, with why. Adding a table here is a privacy-policy decision. */
const KEPT: Record<string, string> = {
	receivables: 'financing record other parties rely on',
	receivable_access: 'other parties’ access to a financing record',
	receivable_attestations: 'other parties’ confirmations',
	receivable_claims: 'other parties’ claims',
	receivable_documents: 'documents of a financing record',
	receivable_offers: 'other parties’ offers',
	receivable_reverifications: 'signed re-verification receipts others hold',
	cairn_projects: 'milestone-desk record other parties rely on',
	cairn_milestones: 'milestone-desk record other parties rely on',
	cairn_attestations: 'other parties’ attestations',
	cairn_documents: 'evidence other parties submitted',
	promo_redemptions: 'kept for a code\u2019s use count, unlinked from the account (tenant_id becomes deleted:<id>)',
};

/** Deleted by name in delete.ts itself (the account rows go last). */
const DELETED_IN_ROUTE = ['tenant_memberships'];

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name.startsWith('.')) continue;
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(ts|mjs|js|sql|astro)$/.test(name)) out.push(p);
	}
	return out;
}

function perAccountTables(): { tenant: Set<string>; user: Set<string> } {
	const cols = new Map<string, Set<string>>();
	const add = (t: string, c: string) => { const k = t.toLowerCase(); if (!cols.has(k)) cols.set(k, new Set()); cols.get(k)!.add(c.toLowerCase()); };
	const files = ['src', 'migrations', 'migrations-pg']
		.map((d) => path.join(ROOT, d))
		.filter((d) => { try { return statSync(d).isDirectory(); } catch { return false; } })
		.flatMap((d) => walk(d));
	for (const f of files) {
		const text = readFileSync(f, 'utf8');
		for (const m of text.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+"?([a-z_0-9]+)"?\s*\(([\s\S]*?)\)\s*[;`'"]/gi)) {
			// Columns start a line or follow "(" or "," (one-line CREATE TABLE statements too).
			for (const c of m[2].matchAll(/(?:^|[(,])\s*"?([a-z_0-9]+)"?\s+[A-Za-z]/gim)) add(m[1], c[1]);
		}
		for (const m of text.matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?([a-z_0-9]+)\s+ADD COLUMN(?: IF NOT EXISTS)?\s+([a-z_0-9]+)/gi)) add(m[1], m[2]);
	}
	const tenant = new Set([...cols].filter(([, c]) => c.has('tenant_id')).map(([t]) => t));
	const user = new Set([...cols].filter(([, c]) => !c.has('tenant_id') && c.has('user_id')).map(([t]) => t));

	// The RLS classification lists tables that exist only in the database (created before
	// this repo tracked them).
	const rls = readFileSync(path.join(ROOT, 'src/scripts/genRlsPolicies.mjs'), 'utf8');
	const list = (name: string) => [...(rls.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))?.[1] ?? '').matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
	for (const t of list('TENANT')) tenant.add(t);
	for (const t of list('USER')) user.add(t);
	return { tenant, user };
}

const verifyTables = [...readFileSync(path.join(ROOT, 'src/lib/verifyAccountDelete.ts'), 'utf8').matchAll(/table: '([a-z_0-9]+)'/g)].map((m) => m[1]);
const route = readFileSync(path.join(ROOT, 'src/pages/api/account/delete.ts'), 'utf8');

describe('account deletion covers every per-account table', () => {
	const { tenant, user } = perAccountTables();
	const covered = new Set<string>([...TENANT_TABLES, ...USER_TABLES, ...verifyTables, ...DELETED_IN_ROUTE, ...Object.keys(KEPT)]);

	it('finds the per-account tables (sanity)', () => {
		expect(tenant.size).toBeGreaterThan(60);
		expect(tenant.has('wallets')).toBe(true);
		expect(tenant.has('receivables')).toBe(true);
	});

	it('deletes or deliberately keeps every table with a tenant_id', () => {
		expect([...tenant].filter((t) => !covered.has(t)).sort()).toEqual([]);
	});

	it('deletes every per-user table', () => {
		expect([...user].filter((t) => !covered.has(t)).sort()).toEqual([]);
	});

	it('never deletes a table it promises to keep', () => {
		for (const t of Object.keys(KEPT)) {
			expect(TENANT_TABLES as readonly string[], t).not.toContain(t);
			expect(route, t).not.toMatch(new RegExp(`DELETE FROM ${t}\\b`));
		}
	});

	it('scopes every generated delete by the account', () => {
		expect(route).toMatch(/sql: `DELETE FROM \$\{t\} WHERE tenant_id = \?`, args: \[tenantId\]/);
		expect(route).toMatch(/sql: `DELETE FROM \$\{t\} WHERE user_id = \?`, args: \[id\]/);
		for (const t of [...TENANT_TABLES, ...USER_TABLES]) expect(t).toMatch(/^[a-z_0-9]+$/);
	});

	it('removes the account rows themselves, in the same transaction', () => {
		expect(route).toMatch(/DELETE FROM tenants WHERE id = \?`, args: \[tenantId\]/);
		expect(route).toMatch(/DELETE FROM auth_users WHERE id = \?`, args: \[id\]/);
		expect(route).toMatch(/await db\.batch\(statements, 'write'\)/);
		expect(route).not.toMatch(/\.catch\(\(\) => \{\}\)/);
	});

	it('keeps the Verify tables and the kept tables apart', () => {
		for (const t of Object.keys(KEPT)) expect(verifyTables, t).not.toContain(t);
	});
});
