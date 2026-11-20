import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The Verify steps table on the owner's admin page (src/lib/adminVerifySteps.ts): for each
 * account that signed up through Verify or holds a Verify destination, how many addresses it
 * has registered, claimed and verified, with totals above.
 *
 * Pinned here: the step of one address, read from the real state columns of verify_destinations
 * with the same rule a payer's check uses; that each step counts the ones after it; that a
 * payment QR is counted apart; who is in the table; and that the totals count an account once
 * per step and a shared tenant's addresses once. Every id and address is invented.
 */
const mem = vi.hoisted(() => ({
	destinations: [] as Record<string, unknown>[],
	users: [] as Record<string, unknown>[],
	statements: [] as Array<{ sql: string; args: unknown[] }>,
}));

vi.mock('@/lib/verifyRegistry', () => ({ ensureVerifyTables: async () => {} }));
vi.mock('@/lib/db', () => {
	const execute = async (stmt: any) => {
		const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ').trim();
		const args = (typeof stmt === 'string' ? [] : stmt.args) ?? [];
		mem.statements.push({ sql, args });
		const ok = (rows: unknown[]) => ({ rows, rowsAffected: 0 });
		if (sql.startsWith('SELECT column_name FROM information_schema.columns')) return ok([{ column_name: 'signup_service' }, { column_name: 'last_active_on' }]);
		if (sql.startsWith('SELECT tenant_id, kind, proof_status')) return ok(mem.destinations.filter((d) => d.tenant_id !== args[0]));
		if (sql.startsWith('SELECT u.id, u.email, u.created_at, u.signup_service, tm.tenant_id')) return ok(mem.users);
		throw new Error(`unexpected SQL in test: ${sql}`);
	};
	return { db: { execute, batch: async () => { throw new Error('batch not expected'); } } };
});

import {
	VERIFY_SIGNUP_SERVICE,
	VERIFY_STEPS_LIMIT,
	countVerifySteps,
	listVerifySteps,
	verifyStepOf,
	verifyStepTotals,
	type VerifyDestinationState,
} from '../../src/lib/adminVerifySteps';
import { merchantAddressAssurance } from '../../src/lib/verifyAnchor';
import { DEMO_TENANT_ID } from '../../src/lib/demo';
import { serviceForPath } from '../../src/lib/signupService';
import { __resetAccountActivityForTests } from '../../src/lib/accountActivity';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

/** Anything confirmed at or after this is fresh (the suite's clock is 2026-11-05 12:00 UTC). */
const CUTOFF = '2026-11-04 12:00:00';

const address = (over: Partial<VerifyDestinationState> = {}): VerifyDestinationState => ({
	kind: 'address', proofStatus: 'unproven', proofMethod: 'none', proofDomain: null,
	provenAt: null, domainAnchoredAt: null, lastConfirmedAt: null, ...over,
});
const REGISTERED = address();
const CLAIMED = address({ proofStatus: 'proven', proofMethod: 'micro_deposit', provenAt: '2026-11-01 09:00:00' });
const VERIFIED = address({
	proofStatus: 'proven', proofMethod: 'well_known', proofDomain: 'shop.example',
	provenAt: '2026-11-01 09:00:00', domainAnchoredAt: '2026-11-01 09:00:00', lastConfirmedAt: '2026-11-05 06:00:00',
});
const QR = address({ kind: 'qr' });

/** A destination row as the database returns it. */
const dbRow = (tenantId: string, d: VerifyDestinationState) => ({
	tenant_id: tenantId, kind: d.kind, proof_status: d.proofStatus, proof_method: d.proofMethod, proof_domain: d.proofDomain,
	proven_at: d.provenAt, domain_anchored_at: d.domainAnchoredAt, last_confirmed_at: d.lastConfirmedAt,
});

beforeEach(() => {
	mem.destinations = [];
	mem.users = [];
	mem.statements = [];
	__resetAccountActivityForTests();
});

describe('the step of one address', () => {
	it('registered until its control is proven', () => {
		expect(verifyStepOf(REGISTERED, CUTOFF)).toBe('registered');
		expect(verifyStepOf(address({ proofStatus: 'lapsed', proofMethod: 'well_known', proofDomain: 'shop.example' }), CUTOFF)).toBe('registered');
	});

	it('claimed once control is proven, by a self-send or any other method', () => {
		expect(verifyStepOf(CLAIMED, CUTOFF)).toBe('claimed');
	});

	it('verified when a proven domain lists it and that was confirmed in the last 24 hours', () => {
		expect(verifyStepOf(VERIFIED, CUTOFF)).toBe('verified');
	});

	it('an anchor nobody re-confirmed in 24 hours reads claimed, as a payer would see it', () => {
		expect(verifyStepOf({ ...VERIFIED, lastConfirmedAt: '2026-11-03 06:00:00' }, CUTOFF)).toBe('claimed');
	});

	it('a leftover domain with no anchor date is not an anchor', () => {
		expect(verifyStepOf({ ...CLAIMED, proofDomain: 'shop.example' }, CUTOFF)).toBe('claimed');
	});

	it('is the public rule itself, not a copy of it', () => {
		for (const d of [CLAIMED, VERIFIED, { ...VERIFIED, lastConfirmedAt: '2026-11-03 06:00:00' }]) {
			expect(verifyStepOf(d, CUTOFF)).toBe(merchantAddressAssurance(d, CUTOFF).level);
		}
		const source = read('src/lib/adminVerifySteps.ts');
		expect(source).toContain("import { merchantAddressAssurance, staleCutoffUtc } from './verifyAnchor';");
	});

	it('reads the state columns verify_destinations really has', () => {
		const registry = read('src/lib/verifyRegistry.ts');
		const created = registry.slice(registry.indexOf('CREATE TABLE IF NOT EXISTS verify_destinations ('), registry.indexOf('const ENSURE_IDX'));
		for (const column of ['kind', 'proof_method', 'proof_status', 'proof_domain', 'proven_at']) expect(created, column).toMatch(new RegExp(`\\b${column}\\s+TEXT`));
		expect(read('migrations-pg/0035_verify_domain_anchor.sql')).toContain('ADD COLUMN IF NOT EXISTS domain_anchored_at TEXT');
		expect(read('migrations-pg/0034_verify_failclosed_heartbeat.sql')).toContain('ADD COLUMN IF NOT EXISTS last_confirmed_at TEXT');
		const query = read('src/lib/adminVerifySteps.ts');
		expect(query).toContain('SELECT tenant_id, kind, proof_status, proof_method, proof_domain, proven_at, domain_anchored_at, last_confirmed_at');
	});
});

describe('counting an account', () => {
	it('each step counts the ones after it', () => {
		expect(countVerifySteps([REGISTERED, CLAIMED, VERIFIED], CUTOFF)).toEqual({ registered: 3, claimed: 2, verified: 1, qrs: 0 });
	});

	it('a payment QR is a destination but not an address: it is counted apart', () => {
		expect(countVerifySteps([QR, REGISTERED], CUTOFF)).toEqual({ registered: 1, claimed: 0, verified: 0, qrs: 1 });
		expect(countVerifySteps([address({ kind: 'qr', proofStatus: 'proven', proofMethod: 'account_claim' })], CUTOFF)).toEqual({ registered: 0, claimed: 0, verified: 0, qrs: 1 });
	});

	it('nothing registered is all zeros', () => {
		expect(countVerifySteps([], CUTOFF)).toEqual({ registered: 0, claimed: 0, verified: 0, qrs: 0 });
	});
});

describe('who is in the table', () => {
	it('asks for accounts that signed up through Verify, or belong to a tenant with a destination, never the demo tenant', async () => {
		await listVerifySteps();
		const users = mem.statements.find((s) => s.sql.startsWith('SELECT u.id, u.email, u.created_at'))!;
		expect(users.sql).toContain('WHERE u.signup_service = ? OR tm.tenant_id IN (SELECT d.tenant_id FROM verify_destinations d WHERE d.tenant_id <> ?)');
		expect(users.args).toEqual([VERIFY_SIGNUP_SERVICE, DEMO_TENANT_ID]);
		expect(VERIFY_SIGNUP_SERVICE).toBe(serviceForPath('/dashboard/verify').id);
		const destinations = mem.statements.find((s) => s.sql.startsWith('SELECT tenant_id, kind'))!;
		expect(destinations.sql).toContain('WHERE tenant_id <> ?');
		expect(destinations.args).toEqual([DEMO_TENANT_ID]);
	});

	it('lists each account once, newest first, with its counts', async () => {
		mem.destinations = [dbRow('t-shop', REGISTERED), dbRow('t-shop', CLAIMED), dbRow('t-shop', VERIFIED), dbRow('t-qr', QR)];
		mem.users = [
			{ id: 'u-qr', email: 'qr.only@example.test', created_at: '2026-11-02 10:00:00', signup_service: 'wallet-watcher', tenant_id: 't-qr' },
			{ id: 'u-empty', email: 'signed.up.only@example.test', created_at: '2026-11-04 10:00:00', signup_service: 'verify', tenant_id: 't-empty' },
			{ id: 'u-shop', email: 'owner@shop.example', created_at: '2026-11-03 10:00:00', signup_service: 'verify', tenant_id: 't-shop' },
		];
		const view = await listVerifySteps();
		expect(view.rows.map((r) => [r.userId, r.counts])).toEqual([
			['u-empty', { registered: 0, claimed: 0, verified: 0, qrs: 0 }],
			['u-shop', { registered: 3, claimed: 2, verified: 1, qrs: 0 }],
			['u-qr', { registered: 0, claimed: 0, verified: 0, qrs: 1 }],
		]);
		expect(view.totals).toEqual({ accounts: 3, registered: 1, claimed: 1, verified: 1, addresses: { registered: 3, claimed: 2, verified: 1 } });
	});

	it('an account in two tenants adds them up, and is still one row', async () => {
		mem.destinations = [dbRow('t-1', CLAIMED), dbRow('t-2', REGISTERED)];
		mem.users = [
			{ id: 'u-two', email: 'two@example.test', created_at: '2026-11-03 10:00:00', signup_service: 'verify', tenant_id: 't-1' },
			{ id: 'u-two', email: 'two@example.test', created_at: '2026-11-03 10:00:00', signup_service: 'verify', tenant_id: 't-2' },
		];
		const view = await listVerifySteps();
		expect(view.rows).toHaveLength(1);
		expect(view.rows[0]).toMatchObject({ tenantIds: ['t-1', 't-2'], counts: { registered: 2, claimed: 1, verified: 0, qrs: 0 } });
	});

	it('the demo tenant is never counted', async () => {
		mem.destinations = [dbRow(DEMO_TENANT_ID, VERIFIED)];
		mem.users = [{ id: 'u-x', email: 'x@example.test', created_at: '2026-11-03 10:00:00', signup_service: 'verify', tenant_id: DEMO_TENANT_ID }];
		const view = await listVerifySteps();
		expect(view.rows[0].counts).toEqual({ registered: 0, claimed: 0, verified: 0, qrs: 0 });
		expect(view.totals.addresses).toEqual({ registered: 0, claimed: 0, verified: 0 });
	});

	it('shows the newest accounts and totals every one', async () => {
		mem.users = Array.from({ length: VERIFY_STEPS_LIMIT + 5 }, (_, i) => ({
			id: `u-${String(i).padStart(3, '0')}`, email: `n${i}@example.test`, created_at: `2026-10-01 00:${String(i % 60).padStart(2, '0')}:00`, signup_service: 'verify', tenant_id: null,
		}));
		const view = await listVerifySteps();
		expect(view.rows).toHaveLength(VERIFY_STEPS_LIMIT);
		expect(view.totals.accounts).toBe(VERIFY_STEPS_LIMIT + 5);
	});
});

describe('the totals', () => {
	it('count an account once per step it reached, and a shared tenant once', () => {
		// Two sign-ins of one person (Google and GitHub on one address) share a tenant.
		const shared = { registered: 2, claimed: 1, verified: 0, qrs: 0 };
		const rows = [
			{ userId: 'u-google', email: null, createdAt: null, signupService: 'verify', tenantIds: ['t-shared'], counts: shared },
			{ userId: 'u-github', email: null, createdAt: null, signupService: 'verify', tenantIds: ['t-shared'], counts: shared },
			{ userId: 'u-none', email: null, createdAt: null, signupService: 'verify', tenantIds: [], counts: { registered: 0, claimed: 0, verified: 0, qrs: 0 } },
		];
		expect(verifyStepTotals(rows, new Map([['t-shared', shared]]))).toEqual({
			accounts: 3, registered: 2, claimed: 2, verified: 0, addresses: { registered: 2, claimed: 1, verified: 0 },
		});
	});
});

describe('the page', () => {
	const page = read('src/pages/admin/index.astro');
	const table = read('src/components/admin/VerifySteps.astro');

	it('renders the table as a component with its totals above the rows', () => {
		expect(page).toContain("import VerifySteps from '@/components/admin/VerifySteps.astro';");
		expect(page).toContain('<VerifySteps />');
		expect(table.indexOf('class="adm-stats"')).toBeLessThan(table.indexOf('class="adm-table"'));
		expect(table).toContain("import './VerifySteps.css';");
		expect(table).toContain("from '@/lib/adminVerifySteps'");
	});

	it('names the three steps and the QR count', () => {
		const head = table.slice(table.indexOf('<thead>'), table.indexOf('</thead>'));
		expect(head.match(/copy\.col\w+/g)).toEqual(['copy.colAccount', 'copy.colSignedUp', 'copy.colProduct', 'copy.colRegistered', 'copy.colClaimed', 'copy.colVerified', 'copy.colQrs']);
	});
});
