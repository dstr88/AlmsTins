import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { PLAN_LIMIT_FREE, PLAN_LIMIT_STANDARD } from '../../src/lib/receivables/copy/plan';

/**
 * src/lib/receivables/server/entitlements.ts (tier T1): which plan an account is on, what it holds
 * open on the loan paper, and whether it may open one more contract. Runs the module's real SQL
 * against tests/helpers/receivablesDbFake.ts; the registry's own ensure creates the tables first,
 * the way production does. No network, no clock: nothing here ages. The work paper's side of the
 * count (sealed projects) is covered by the work paper's own suite.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));
vi.mock('@/lib/owner', () => ({
	OWNER_TENANT_ID: 'tenant-owner',
	isOwner: (t: unknown) => String(t ?? '').toLowerCase() === 'tenant-owner',
}));

type Ent = typeof import('../../src/lib/receivables/server/entitlements');
let fake: ReceivablesDbFake;
let ent: Ent;

const A = 'tenant-a';
const B = 'tenant-b';
const R_REAL = 'a1'.repeat(32);
const R_TEST = 'b2'.repeat(32);

function seedReceivable(id: string, isTest: boolean) {
	return fake.seed('receivables', {
		id, tenant_id: 'tenant-supplier', supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: `INV-${id.slice(0, 4)}`,
		face: 1000, currency: 'USD', terms: null, due_date: '2026-12-01', acknowledged_at: null,
		rtype: 'invoice', payment_method: null, details_json: null, is_test: isTest,
		manifest_json: '{}', signature_json: null, digest: 'd'.repeat(64), anchor_json: null,
		settled_at: null, settlement_json: null, settlement_digest: null,
		created_at: '2026-09-01 10:00:00', updated_at: null,
	});
}

let claimSeq = 0;
function seedClaim(tenantId: string, receivableId: string, status: 'active' | 'discharged' = 'active') {
	claimSeq++;
	return fake.seed('receivable_claims', {
		id: `claim-${claimSeq}`, receivable_id: receivableId, tenant_id: tenantId, financier: `Lender ${claimSeq}`,
		amount: 100, currency: 'USD', claim_date: '2026-09-02', status,
		manifest_json: '{}', signature_json: null, digest: 'e'.repeat(64), anchor_json: null,
		discharged_at: status === 'discharged' ? '2026-10-01' : null, affirmed_at: null, affirmed_by: null,
		created_at: `2026-09-02 10:00:${String(claimSeq).padStart(2, '0')}`,
	});
}

function seedSubscription(tenantId: string, over: Record<string, unknown> = {}) {
	return fake.seed('receivables_subscriptions', {
		tenant_id: tenantId, plan: 'free', status: 'active', stripe_customer_id: null, stripe_subscription_id: null,
		stripe_price_id: null, current_period_end: null, free_locked_at: null, free_locked_reason_json: null,
		created_at: '2026-09-01 10:00:00', updated_at: null,
		...over,
	});
}

beforeEach(async () => {
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	claimSeq = 0;
	const reg = await import('../../src/lib/receivablesRegistry');
	await reg.ensureReceivablesTables();
	ent = await import('../../src/lib/receivables/server/entitlements');
});

describe('getReceivablesEntitlements: which plan', () => {
	it('no row is the Free plan: one contract, not locked', async () => {
		expect(await ent.getReceivablesEntitlements(A)).toEqual({
			plan: 'free', label: 'Free', limits: { contracts: 1 }, freeLockedAt: null, freeLockedReason: null,
		});
	});

	it('a live Standard row is ten contracts', async () => {
		seedSubscription(A, { plan: 'standard', status: 'active' });
		const e = await ent.getReceivablesEntitlements(A);
		expect(e.plan).toBe('standard');
		expect(e.label).toBe('Standard');
		expect(e.limits.contracts).toBe(10);
		expect(e.freeLockedAt).toBeNull();
	});

	it('a trialing Standard row counts as live; a canceled one reads as Free', async () => {
		seedSubscription(A, { plan: 'standard', status: 'trialing' });
		expect((await ent.getReceivablesEntitlements(A)).plan).toBe('standard');
		seedSubscription(B, { plan: 'standard', status: 'canceled' });
		expect((await ent.getReceivablesEntitlements(B)).plan).toBe('free');
	});

	it("the deployment owner's account has no limit", async () => {
		const e = await ent.getReceivablesEntitlements('tenant-owner');
		expect(e.plan).toBe('unlimited');
		expect(e.limits.contracts).toBeNull();
	});

	it('a locked Free row carries when and why', async () => {
		seedSubscription(A, {
			free_locked_at: '2026-10-20 09:00:00',
			free_locked_reason_json: JSON.stringify({ claimIds: ['c1', 'c2'], lapsedAts: ['2026-04-01 09:00:00', '2026-10-20 09:00:00'] }),
		});
		const e = await ent.getReceivablesEntitlements(A);
		expect(e.plan).toBe('free');
		expect(e.freeLockedAt).toBe('2026-10-20 09:00:00');
		expect(e.freeLockedReason).toEqual({ claimIds: ['c1', 'c2'], lapsedAts: ['2026-04-01 09:00:00', '2026-10-20 09:00:00'] });
	});

	it('a lock on a Standard row is ignored: the lock belongs to the Free plan', async () => {
		seedSubscription(A, { plan: 'standard', status: 'active', free_locked_at: '2026-10-20 09:00:00' });
		const e = await ent.getReceivablesEntitlements(A);
		expect(e.plan).toBe('standard');
		expect(e.freeLockedAt).toBeNull();
	});
});

describe('countContracts: what the account holds open on the loan paper', () => {
	beforeEach(() => {
		seedReceivable(R_REAL, false);
		seedReceivable(R_TEST, true);
	});

	it('counts active claims on real receivables, not discharged ones, not test records, not other tenants', async () => {
		seedClaim(A, R_REAL, 'active');
		seedClaim(A, R_REAL, 'discharged');
		seedClaim(A, R_TEST, 'active');
		seedClaim(B, R_REAL, 'active');
		expect(await ent.countContracts(A)).toEqual({ claims: 1, projects: 0, total: 1 });
		expect(await ent.countContracts(B)).toEqual({ claims: 1, projects: 0, total: 1 });
	});

	it('a lapsed claim is still status active, so it still holds the slot (D10)', async () => {
		// Lapse is an aging state derived on read; the row stays status 'active'. The count reads
		// status only, so a claim nobody maintained for six months keeps counting until released.
		seedClaim(A, R_REAL, 'active');
		fake.rows('receivable_claims')[0].created_at = '2025-01-01 10:00:00';
		fake.rows('receivable_claims')[0].claim_date = '2025-01-01';
		expect((await ent.countContracts(A)).claims).toBe(1);
	});

	it("answers zero projects while the work paper's tables have never been created", async () => {
		seedClaim(A, R_REAL);
		expect(await ent.countContracts(A)).toEqual({ claims: 1, projects: 0, total: 1 });
	});
});

describe('gateNewContract: may this account open one more', () => {
	beforeEach(() => {
		seedReceivable(R_REAL, false);
		seedReceivable(R_TEST, true);
	});

	it('Free with nothing open: yes, limit 1', async () => {
		expect(await ent.gateNewContract(A)).toEqual({ ok: true, use: { claims: 0, projects: 0, total: 0 }, limit: 1 });
	});

	it('Free with one active claim: plan_limit, in the Free words', async () => {
		seedClaim(A, R_REAL);
		const g = await ent.gateNewContract(A);
		expect(g).toMatchObject({ ok: false, error: 'plan_limit', limit: 1, plan: 'free', use: { total: 1 } });
		expect((g as any).message).toBe(PLAN_LIMIT_FREE);
	});

	it('a claim on a test receivable never fills the slot', async () => {
		seedClaim(A, R_TEST);
		expect((await ent.gateNewContract(A)).ok).toBe(true);
	});

	it('a released claim frees the slot', async () => {
		seedClaim(A, R_REAL, 'discharged');
		expect((await ent.gateNewContract(A)).ok).toBe(true);
	});

	it('Standard: yes at nine, plan_limit at ten, in the Standard words', async () => {
		seedSubscription(A, { plan: 'standard', status: 'active' });
		for (let i = 0; i < 9; i++) seedClaim(A, R_REAL);
		expect(await ent.gateNewContract(A)).toMatchObject({ ok: true, limit: 10, use: { total: 9 } });
		seedClaim(A, R_REAL);
		const g = await ent.gateNewContract(A);
		expect(g).toMatchObject({ ok: false, error: 'plan_limit', limit: 10, plan: 'standard' });
		expect((g as any).message).toBe(PLAN_LIMIT_STANDARD);
	});

	it('a locked Free plan: free_plan_locked even with nothing open, the two dates in the message', async () => {
		seedSubscription(A, {
			free_locked_at: '2026-10-20 09:00:00',
			free_locked_reason_json: JSON.stringify({ claimIds: ['c1', 'c2'], lapsedAts: ['2026-04-01 09:00:00', '2026-10-20 09:00:00'] }),
		});
		const g = await ent.gateNewContract(A);
		expect(g).toMatchObject({ ok: false, error: 'free_plan_locked', lockedAt: '2026-10-20 09:00:00', use: { total: 0 } });
		expect((g as any).message).toContain('(2026-04-01, 2026-10-20)');
		expect((g as any).message).toContain('moves to Standard');
	});

	it('a locked Free plan with no recorded reason still refuses, without dates', async () => {
		seedSubscription(A, { free_locked_at: '2026-10-20 09:00:00' });
		const g = await ent.gateNewContract(A);
		expect(g).toMatchObject({ ok: false, error: 'free_plan_locked', reason: null });
		expect((g as any).message).not.toContain('(');
	});

	it('the owner: yes, whatever it holds', async () => {
		for (let i = 0; i < 50; i++) seedClaim('tenant-owner', R_REAL);
		expect(await ent.gateNewContract('tenant-owner')).toMatchObject({ ok: true, limit: null, use: { total: 50 } });
	});

	it('never counts another tenant toward this one', async () => {
		seedClaim(B, R_REAL);
		seedClaim(B, R_REAL);
		expect((await ent.gateNewContract(A)).ok).toBe(true);
	});
});

describe('getPlanSummary and slotsLeft', () => {
	it('the summary is the entitlements plus what is held', async () => {
		seedReceivable(R_REAL, false);
		seedClaim(A, R_REAL);
		expect(await ent.getPlanSummary(A)).toEqual({
			plan: 'free', label: 'Free', limits: { contracts: 1 }, freeLockedAt: null, freeLockedReason: null,
			use: { claims: 1, projects: 0, total: 1 },
		});
	});

	it('slotsLeft: null for no limit, never below zero', () => {
		expect(ent.slotsLeft(null, 7)).toBeNull();
		expect(ent.slotsLeft(10, 3)).toBe(7);
		expect(ent.slotsLeft(1, 4)).toBe(0);
	});
});
