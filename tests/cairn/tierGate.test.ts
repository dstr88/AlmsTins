import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { PLAN_LIMIT_FREE } from '../../src/lib/receivables/copy/plan';

/**
 * The contract limit on the work paper (receivables tier T1, D9 and D17): sealing a milestone
 * project is where it becomes a contract the account holds, counted together with the account's
 * active claims. A draft is never gated; a test project is neither counted nor limited.
 *
 * Both registries run their real SQL against tests/helpers/receivablesDbFake.ts (the fake does not
 * run addMilestone's SUM over a schedule, so the one milestone row is seeded directly). No network:
 * a seal's stamp attempt fails quietly, as the code allows, and the claim route never stamps.
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
		async stamp(): Promise<never> { throw new Error('no stamping in this suite'); }
		async upgrade(): Promise<never> { throw new Error('no upgrading in this suite'); }
	},
}));

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/receivablesRegistry');
let cairn: typeof import('../../src/lib/cairnRegistry');
let ent: typeof import('../../src/lib/receivables/server/entitlements');

const SUPPLIER = 'tenant-supplier';
const LENDER = 'tenant-lender';
const OTHER = 'tenant-other';
const R1 = 'c0'.repeat(32);
const R2 = 'c1'.repeat(32);
const SEED_A = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';

function seedReceivable(id: string) {
	return fake.seed('receivables', {
		id, tenant_id: SUPPLIER, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: `INV-${id.slice(0, 4)}`,
		face: 1000, currency: 'USD', terms: null, due_date: '2026-12-01', acknowledged_at: null,
		rtype: 'invoice', payment_method: null, details_json: null, is_test: false,
		manifest_json: '{}', signature_json: null, digest: 'd'.repeat(64), anchor_json: null,
		settled_at: null, settlement_json: null, settlement_digest: null,
		created_at: '2026-09-01 10:00:00', updated_at: null,
	});
}

function seedBuyerConfirmation(receivableId: string) {
	return fake.seed('receivable_attestations', {
		id: `att-${receivableId.slice(0, 4)}`, receivable_id: receivableId, tenant_id: SUPPLIER, role: 'buyer', label: 'Bigco Plc',
		statement: 'Confirmed: the invoice is ours and owed.', attested_at: '2026-09-03', manifest_json: '{}',
		signature_json: null, digest: 'f'.repeat(64), anchor_json: null, source: 'debtor_confirmation',
		created_at: '2026-09-03 10:00:00',
	});
}

let claimSeq = 0;
function seedClaim(tenantId: string, receivableId: string) {
	claimSeq++;
	return fake.seed('receivable_claims', {
		id: `claim-${claimSeq}`, receivable_id: receivableId, tenant_id: tenantId, financier: `Lender ${claimSeq}`,
		amount: 100, currency: 'USD', claim_date: '2026-09-02', status: 'active',
		manifest_json: '{}', signature_json: null, digest: 'e'.repeat(64), anchor_json: null,
		discharged_at: null, affirmed_at: null, affirmed_by: null,
		created_at: `2026-09-02 10:00:${String(claimSeq).padStart(2, '0')}`,
	});
}

let projectSeq = 0;
function seedProject(tenantId: string, over: Record<string, unknown> = {}) {
	projectSeq++;
	return fake.seed('cairn_projects', {
		id: `project-${projectSeq}`, tenant_id: tenantId, name: `Bridge ${projectSeq}`, counterparty: 'Works Ltd',
		total_value: 1_000_000, currency: 'NGN', description: null, is_test: false,
		manifest_json: '{}', signature_json: null, digest: 'f'.repeat(64), anchor_json: null,
		updated_at: null, created_at: '2026-09-05 10:00:00', signed_at: '2026-09-06 10:00:00',
		...over,
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

/** A seal-ready draft: one project through createProject, one milestone row seeded directly. */
let milestoneSeq = 0;
async function draftProject(tenantId: string, isTest = false): Promise<string> {
	const created = await cairn.createProject(tenantId, {
		name: 'Ring road, section 2', counterparty: 'Works Ltd', totalValue: 1_000_000, currency: 'NGN', isTest,
	});
	expect(created.ok).toBe(true);
	milestoneSeq++;
	fake.seed('cairn_milestones', {
		id: `milestone-${milestoneSeq}`, project_id: created.id!, tenant_id: tenantId, seq: 1, title: 'Foundation',
		description: null, tranche_amount: 300_000, target_date: '2027-02-01', status: 'pending',
		manifest_json: '{}', signature_json: null, digest: '0'.repeat(64), anchor_json: null,
		created_at: '2026-09-05 10:00:00',
	});
	return created.id!;
}

beforeEach(async () => {
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED_A);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	mem.session = { tenantId: LENDER, isDemo: false };
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
	await reg.ensureReceivablesTables();
	cairn = await import('../../src/lib/cairnRegistry');
	await cairn.ensureCairnTables();
	ent = await import('../../src/lib/receivables/server/entitlements');
	claimSeq = 0;
	projectSeq = 0;
	seedReceivable(R1);
	seedBuyerConfirmation(R1);
	seedReceivable(R2);
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

async function postSeal(projectId: string) {
	const mod = await import('../../src/pages/api/verify/cairn/seal.ts');
	const request = new Request('https://almstins.com/api/verify/cairn/seal', {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId }),
	});
	const res: Response = await (mod.POST as any)({ request });
	return { status: res.status, body: await res.json() };
}

async function getPlan() {
	const mod = await import('../../src/pages/api/verify/receivables/plan.ts');
	const res: Response = await (mod.GET as any)({ request: new Request('https://almstins.com/api/verify/receivables/plan') });
	return { status: res.status, body: await res.json() };
}

const CLAIM = { receivableId: R1, financier: 'Lender Co', amount: 250 };

describe('countContracts on the work paper', () => {
	it('counts sealed, non-test projects of this tenant; a draft is not a contract yet', async () => {
		seedProject(LENDER);
		seedProject(LENDER, { signed_at: null });
		seedProject(LENDER, { is_test: true });
		seedProject(OTHER);
		expect(await ent.countContracts(LENDER)).toEqual({ claims: 0, projects: 1, total: 1 });
	});

	it('adds the two papers together', async () => {
		seedClaim(LENDER, R2);
		seedProject(LENDER);
		expect(await ent.countContracts(LENDER)).toEqual({ claims: 1, projects: 1, total: 2 });
	});

	it('Free with no claims and one sealed project: plan_limit, the project is the contract', async () => {
		seedProject(LENDER);
		expect(await ent.gateNewContract(LENDER)).toMatchObject({ ok: false, error: 'plan_limit', use: { claims: 0, projects: 1, total: 1 } });
	});
});

describe('sealProject under the contract limit', () => {
	it('a draft is never gated; sealing at the limit answers plan_limit and signs nothing', async () => {
		seedClaim(LENDER, R2);
		const id = await draftProject(LENDER);
		const sealed = await cairn.sealProject(LENDER, id);
		expect(sealed).toEqual({ ok: false, error: 'plan_limit', message: PLAN_LIMIT_FREE });
		const row = fake.rows('cairn_projects').find((p) => p.id === id)!;
		expect(row.signed_at ?? null).toBeNull();
		expect(fake.rows('cairn_milestones').every((m) => m.signature_json == null)).toBe(true);
	});

	it('POST /cairn/seal answers 409 for plan_limit and free_plan_locked', async () => {
		seedClaim(LENDER, R2);
		const id = await draftProject(LENDER);
		expect((await postSeal(id)).status).toBe(409);
		fake.rows('receivable_claims')[0].status = 'discharged';
		seedSubscription(LENDER, { free_locked_at: '2026-10-20 09:00:00' });
		const locked = await postSeal(id);
		expect(locked.status).toBe(409);
		expect(locked.body.error).toBe('free_plan_locked');
	});

	it('with the slot free the seal goes through and the project is then the one contract', async () => {
		const id = await draftProject(LENDER);
		const sealed = await cairn.sealProject(LENDER, id);
		expect(sealed.ok).toBe(true);
		const { status, body } = await postClaim(CLAIM);
		expect(status).toBe(409);
		expect(body).toMatchObject({ error: 'plan_limit', use: { claims: 0, projects: 1, total: 1 } });
	});

	it('a test project is neither counted nor limited', async () => {
		seedClaim(LENDER, R2);
		const id = await draftProject(LENDER, true);
		expect((await cairn.sealProject(LENDER, id)).ok).toBe(true);
		expect((await getPlan()).body.use).toEqual({ claims: 1, projects: 0, total: 1 });
	});

	it("the owner's account seals without a limit", async () => {
		for (let i = 0; i < 12; i++) seedProject('tenant-owner');
		const id = await draftProject('tenant-owner');
		expect((await cairn.sealProject('tenant-owner', id)).ok).toBe(true);
	});
});
