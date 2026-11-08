import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { PLAN_LIMIT_FREE, PLAN_LIMIT_STANDARD } from '../../src/lib/receivables/copy/plan';

/**
 * The contract limit where a claim is written (tier T1): POST /claim through addClaim, and GET
 * /plan. The registry runs its real SQL against tests/helpers/receivablesDbFake.ts with the tenant
 * taken from a stubbed session and a fixed signing seed. No network: the claim route never stamps.
 *
 * Pinned here: the order of the refusals in addClaim (a missing confirmation first, the slot
 * second, the headroom last), that a release is never gated, that a test record is neither counted
 * nor limited, and that an account over its limit on ship day keeps every record. The work paper's
 * side (sealing a project) is covered by the work paper's own suite.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

const mem = vi.hoisted(() => ({
	session: { tenantId: 'tenant-lender', isDemo: false } as { tenantId: string; isDemo: boolean } | null,
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
vi.mock('@/lib/owner', () => ({
	OWNER_TENANT_ID: 'tenant-owner',
	isOwner: (t: unknown) => String(t ?? '').toLowerCase() === 'tenant-owner',
}));
vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
	OpenTimestampsAnchor: class {
		readonly type = 'opentimestamps';
		async stamp(): Promise<never> { throw new Error('the claim route must not stamp'); }
		async upgrade(): Promise<never> { throw new Error('the claim route must not upgrade'); }
	},
}));

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/receivablesRegistry');

const SUPPLIER = 'tenant-supplier';
const LENDER = 'tenant-lender';
const OTHER = 'tenant-other-lender';
const R1 = 'c0'.repeat(32);
const R2 = 'c1'.repeat(32);
const SEED_A = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';

function seedReceivable(id: string, over: Record<string, unknown> = {}) {
	return fake.seed('receivables', {
		id, tenant_id: SUPPLIER, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: `INV-${id.slice(0, 4)}`,
		face: 1000, currency: 'USD', terms: null, due_date: '2026-12-01', acknowledged_at: null,
		rtype: 'invoice', payment_method: null, details_json: null, is_test: false,
		manifest_json: '{}', signature_json: null, digest: 'd'.repeat(64), anchor_json: null,
		settled_at: null, settlement_json: null, settlement_digest: null,
		created_at: '2026-09-01 10:00:00', updated_at: null,
		...over,
	});
}

/** A genuine debtor confirmation on the record, so the diligence gate passes for every lender. */
let attSeq = 0;
function seedBuyerConfirmation(receivableId: string) {
	attSeq++;
	return fake.seed('receivable_attestations', {
		id: `att-${attSeq}`, receivable_id: receivableId, tenant_id: SUPPLIER, role: 'buyer', label: 'Bigco Plc',
		statement: 'Confirmed: the invoice is ours and owed.', attested_at: '2026-09-03', manifest_json: '{}',
		signature_json: null, digest: 'f'.repeat(64), anchor_json: null, source: 'debtor_confirmation',
		created_at: `2026-09-03 10:00:${String(attSeq).padStart(2, '0')}`,
	});
}

let claimSeq = 0;
function seedClaim(tenantId: string, receivableId: string, amount = 100) {
	claimSeq++;
	return fake.seed('receivable_claims', {
		id: `claim-${claimSeq}`, receivable_id: receivableId, tenant_id: tenantId, financier: `Lender ${claimSeq}`,
		amount, currency: 'USD', claim_date: '2026-09-02', status: 'active',
		manifest_json: '{}', signature_json: null, digest: 'e'.repeat(64), anchor_json: null,
		discharged_at: null, affirmed_at: null, affirmed_by: null,
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

async function fresh() {
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
	await reg.ensureReceivablesTables();
	claimSeq = 0;
	attSeq = 0;
}

beforeEach(async () => {
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED_A);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	mem.session = { tenantId: LENDER, isDemo: false };
	await fresh();
});
afterEach(() => { vi.unstubAllEnvs(); });

async function postClaim(body: unknown) {
	const mod = await import('../../src/pages/api/verify/receivables/claim.ts');
	const request = new Request('https://almstins.com/api/verify/receivables/claim', {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
	});
	const res: Response = await (mod.POST as any)({ request });
	return { status: res.status, body: await res.json() };
}

async function getPlan() {
	const mod = await import('../../src/pages/api/verify/receivables/plan.ts');
	const request = new Request('https://almstins.com/api/verify/receivables/plan');
	const res: Response = await (mod.GET as any)({ request });
	return { status: res.status, body: await res.json() };
}

const CLAIM = { receivableId: R1, financier: 'Lender Co', amount: 250 };

describe('POST /claim under the contract limit', () => {
	beforeEach(() => {
		seedReceivable(R1);
		seedBuyerConfirmation(R1);
		seedReceivable(R2);
	});

	it('Free with nothing open records the claim (200)', async () => {
		const { status, body } = await postClaim(CLAIM);
		expect(status).toBe(200);
		expect(body).toMatchObject({ ok: true, claimed: 250, available: 750 });
	});

	it('Free holding one active claim elsewhere: 409 plan_limit with what it holds and the limit', async () => {
		seedClaim(LENDER, R2);
		const { status, body } = await postClaim(CLAIM);
		expect(status).toBe(409);
		expect(body).toEqual({
			ok: false, error: 'plan_limit', message: PLAN_LIMIT_FREE,
			use: { claims: 1, projects: 0, total: 1 }, limit: 1, plan: 'free',
		});
		expect(fake.rows('receivable_claims')).toHaveLength(1);
	});

	it('releasing the held claim frees the slot: the next claim records', async () => {
		const held = seedClaim(LENDER, R2);
		expect((await postClaim(CLAIM)).status).toBe(409);
		const released = await reg.dischargeClaim(LENDER, held.id);
		expect(released.ok).toBe(true);
		expect((await postClaim(CLAIM)).status).toBe(200);
	});

	it('a test receivable is neither counted nor limited', async () => {
		seedClaim(LENDER, R2);
		fake.rows('receivables').find((r) => r.id === R1)!.is_test = true;
		const { status } = await postClaim(CLAIM);
		expect(status).toBe(200);
	});

	it('Standard: the tenth claim records, the eleventh answers 409 in the Standard words', async () => {
		seedSubscription(LENDER, { plan: 'standard', status: 'active' });
		for (let i = 0; i < 9; i++) seedClaim(LENDER, R2);
		expect((await postClaim(CLAIM)).status).toBe(200);
		const { status, body } = await postClaim({ ...CLAIM, amount: 10 });
		expect(status).toBe(409);
		expect(body).toMatchObject({ error: 'plan_limit', message: PLAN_LIMIT_STANDARD, limit: 10, plan: 'standard', use: { total: 10 } });
	});

	it('a locked Free plan: 409 free_plan_locked with nothing open', async () => {
		seedSubscription(LENDER, {
			free_locked_at: '2026-10-20 09:00:00',
			free_locked_reason_json: JSON.stringify({ claimIds: ['x', 'y'], lapsedAts: ['2026-04-01 09:00:00', '2026-10-20 09:00:00'] }),
		});
		const { status, body } = await postClaim(CLAIM);
		expect(status).toBe(409);
		expect(body).toMatchObject({ ok: false, error: 'free_plan_locked', lockedAt: '2026-10-20 09:00:00', use: { total: 0 } });
		expect(body.message).toContain('2026-04-01, 2026-10-20');
	});

	it('order: a missing debtor confirmation is answered before the slot', async () => {
		fake.tables.set('receivable_attestations', []);
		seedClaim(LENDER, R2);
		const { status, body } = await postClaim(CLAIM);
		expect(status).toBe(409);
		expect(body.error).toBe('diligence_required');
	});

	it('order: the slot is answered before the headroom', async () => {
		seedClaim(OTHER, R1, 1000); // another lender has the whole face: no headroom left on R1
		seedClaim(LENDER, R2);
		const { body } = await postClaim(CLAIM);
		expect(body.error).toBe('plan_limit');
	});

	it('ship day: an account holding four claims keeps them, is refused a fifth, and may release any of them', async () => {
		const held = [seedClaim(LENDER, R2), seedClaim(LENDER, R2), seedClaim(LENDER, R2), seedClaim(LENDER, R2)];
		expect((await postClaim(CLAIM)).status).toBe(409);
		for (const c of held) expect((await reg.dischargeClaim(LENDER, c.id)).ok).toBe(true);
		expect(fake.rows('receivable_claims').filter((c) => c.status === 'active')).toHaveLength(0);
		expect((await postClaim(CLAIM)).status).toBe(200);
	});

	it("the owner's account has no limit", async () => {
		mem.session = { tenantId: 'tenant-owner', isDemo: false };
		for (let i = 0; i < 12; i++) seedClaim('tenant-owner', R2);
		expect((await postClaim(CLAIM)).status).toBe(200);
	});
});

describe('GET /plan', () => {
	it('answers the plan and what the account holds', async () => {
		seedReceivable(R2);
		seedClaim(LENDER, R2);
		const { status, body } = await getPlan();
		expect(status).toBe(200);
		expect(body).toEqual({
			ok: true, plan: 'free', label: 'Free', limits: { contracts: 1 }, freeLockedAt: null, freeLockedReason: null,
			use: { claims: 1, projects: 0, total: 1 },
		});
	});

	it('Standard shows ten', async () => {
		seedSubscription(LENDER, { plan: 'standard', status: 'active' });
		expect((await getPlan()).body).toMatchObject({ plan: 'standard', label: 'Standard', limits: { contracts: 10 } });
	});

	it('is a read: the demo sees the Free plan; no session is 401', async () => {
		mem.session = { tenantId: 'tenant-demo', isDemo: true };
		expect((await getPlan()).body).toMatchObject({ ok: true, plan: 'free' });
		mem.session = null;
		expect((await getPlan()).status).toBe(401);
	});
});
