import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * Characterization of the routes the receivables S0b slice moves onto anchorNow, written and run
 * green against the ORIGINAL routes before they changed:
 *   - POST /api/verify/receivables/diligence-accept: its response shape for a stamped, a failed
 *     and a rate-limited Bitcoin stamp (pinned: the desk and registry read these fields);
 *   - POST /discharge and /settle: their status codes and bodies (S0b only ADDS the anchor
 *     fields to a success);
 *   - GET /api/cron/upgrade-anchors: auth, and that only a confirmed receipt is persisted.
 *
 * The OpenTimestamps client is stubbed; no calendar is ever called. The registry runs its real
 * SQL against tests/helpers/receivablesDbFake.ts, with the tenant taken from a stubbed session.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

const mem = vi.hoisted(() => ({
	session: { tenantId: 'tenant-lender', isDemo: false } as { tenantId: string; isDemo: boolean } | null,
	stamps: [] as string[],
	upgrades: [] as string[],
	failStamp: false,
	failUpgradeFor: new Set<string>(),
	confirm: new Set<string>(),
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
	OpenTimestampsAnchor: class {
		readonly type = 'opentimestamps';
		async stamp(digest: string) {
			if (mem.failStamp) throw new Error('calendar unreachable');
			mem.stamps.push(digest);
			return { type: 'opentimestamps', digest, receipt: 'cGVuZGluZw==', anchoredAt: null };
		}
		async upgrade(receipt: any) {
			mem.upgrades.push(receipt.digest);
			if (mem.failUpgradeFor.has(receipt.digest)) throw new Error('calendar unreachable');
			return mem.confirm.has(receipt.digest) ? { ...receipt, anchoredAt: '2026-10-10T13:00:00.000Z' } : receipt;
		}
	},
}));

let fake: ReceivablesDbFake;

const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const RID = 'c0'.repeat(32);
const SEED_A = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';

beforeEach(async () => {
	vi.resetModules();
	vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED_A);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	vi.stubEnv('CRON_SECRET', 'test-cron-secret');
	fake = createReceivablesDbFake();
	holder.db = fake;
	mem.session = { tenantId: LENDER, isDemo: false };
	mem.stamps = [];
	mem.upgrades = [];
	mem.failStamp = false;
	mem.failUpgradeFor = new Set();
	mem.confirm = new Set();
	const reg = await import('../../src/lib/receivablesRegistry');
	await reg.ensureReceivablesTables();
	fake.seed('receivables', {
		id: RID, tenant_id: OWNER, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: 'INV-0042',
		face: 1000, currency: 'USD', is_test: false, manifest_json: '{}', signature_json: null,
		digest: 'd'.repeat(64), anchor_json: null, settled_at: null, created_at: '2026-09-01 10:00:00',
	});
});
afterEach(() => { vi.unstubAllEnvs(); });

async function post(path: string, body: unknown) {
	const mod = await import(`../../src/pages/api/verify/receivables/${path}.ts`);
	const request = new Request(`https://almstins.com/api/verify/receivables/${path}`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
	});
	const res: Response = await mod.POST({ request });
	return { status: res.status, body: await res.json() };
}

const DILIGENCE = { receivableId: RID, financier: 'Lender Co', method: 'phone' };

describe('POST /diligence-accept response shape (pinned)', () => {
	it('a stamped acceptance', async () => {
		const { status, body } = await post('diligence-accept', DILIGENCE);
		expect(status).toBe(200);
		const att = fake.rows('receivable_attestations')[0];
		expect(body).toEqual({
			ok: true, attestationId: att.id, digest: att.digest, signed: true, anchored: true,
			anchor: { type: 'opentimestamps', digest: att.digest, receipt: 'cGVuZGluZw==', anchoredAt: null },
		});
		expect(Object.keys(body)).toEqual(['ok', 'attestationId', 'digest', 'signed', 'anchored', 'anchor']);
		expect(mem.stamps).toEqual([att.digest]);
		expect(JSON.parse(att.anchor_json)).toEqual(body.anchor);
		expect(att.tenant_id).toBe(LENDER);
	});

	it('a failed stamp leaves the signed acceptance standing', async () => {
		mem.failStamp = true;
		const { status, body } = await post('diligence-accept', DILIGENCE);
		expect(status).toBe(200);
		expect(body).toMatchObject({ ok: true, signed: true, anchored: false, anchorError: 'calendar unreachable' });
		expect(Object.keys(body)).toEqual(['ok', 'attestationId', 'digest', 'signed', 'anchored', 'anchorError']);
		expect(fake.rows('receivable_attestations')[0].anchor_json ?? null).toBeNull();
	});

	it('the 31st stamp in an hour is reported as rate_limited, and the acceptance is still recorded', async () => {
		for (let i = 0; i < 30; i++) expect((await post('diligence-accept', DILIGENCE)).body.anchored).toBe(true);
		const { status, body } = await post('diligence-accept', DILIGENCE);
		expect(status).toBe(200);
		expect(body).toMatchObject({ ok: true, anchored: false, anchorError: 'rate_limited' });
		expect(mem.stamps).toHaveLength(30);
		expect(fake.rows('receivable_attestations')).toHaveLength(31);
	});

	it('an unknown receivable is 404 and stamps nothing; no session is 401; a demo session is 403', async () => {
		expect((await post('diligence-accept', { ...DILIGENCE, receivableId: 'ff'.repeat(32) })).status).toBe(404);
		mem.session = null;
		expect((await post('diligence-accept', DILIGENCE))).toEqual({ status: 401, body: { ok: false, error: 'unauthenticated' } });
		mem.session = { tenantId: LENDER, isDemo: true };
		expect((await post('diligence-accept', DILIGENCE))).toEqual({ status: 403, body: { ok: false, error: 'demo_readonly' } });
		expect(mem.stamps).toEqual([]);
	});
});

describe('POST /discharge and /settle (pinned)', () => {
	const seedClaim = () => fake.seed('receivable_claims', {
		id: 'claim-1', receivable_id: RID, tenant_id: LENDER, financier: 'Lender Co', amount: 400, currency: 'USD',
		claim_date: '2026-09-02', status: 'active', manifest_json: '{}', signature_json: null,
		digest: 'e'.repeat(64), anchor_json: null, created_at: '2026-09-02 10:00:00',
	});

	it('discharge: the body carries the registry result; 404 for a claim that is not yours; 409 when already discharged', async () => {
		seedClaim();
		const ok = await post('discharge', { claimId: 'claim-1', tenantId: OWNER });
		expect(ok.status).toBe(200);
		expect(ok.body).toMatchObject({ ok: true, digest: fake.rows('receivable_claims')[0].discharge_digest, signed: true, claimed: 0, available: 1000, face: 1000 });
		expect((await post('discharge', { claimId: 'claim-1' })).status).toBe(409);
		mem.session = { tenantId: OWNER, isDemo: false };
		expect((await post('discharge', { claimId: 'claim-1' }))).toEqual({ status: 404, body: { ok: false, error: 'not_found', message: 'No claim of yours found for that ID.' } });
	});

	it('settle: the body carries the registry result; 404 for a receivable that is not yours; 409 when already settled', async () => {
		mem.session = { tenantId: OWNER, isDemo: false };
		const ok = await post('settle', { receivableId: RID });
		expect(ok.status).toBe(200);
		expect(ok.body).toMatchObject({ ok: true, digest: fake.rows('receivables')[0].settlement_digest, signed: true });
		expect(typeof ok.body.settledAt).toBe('string');
		expect((await post('settle', { receivableId: RID })).status).toBe(409);
		mem.session = { tenantId: LENDER, isDemo: false };
		expect((await post('settle', { receivableId: RID, tenantId: OWNER })).status).toBe(404);
	});

	it('no session is 401 and a demo session is 403, for both', async () => {
		mem.session = null;
		expect((await post('discharge', { claimId: 'x' })).status).toBe(401);
		expect((await post('settle', { receivableId: RID })).status).toBe(401);
		mem.session = { tenantId: OWNER, isDemo: true };
		expect((await post('discharge', { claimId: 'x' })).status).toBe(403);
		expect((await post('settle', { receivableId: RID })).status).toBe(403);
	});
});

describe('GET /api/cron/upgrade-anchors (pinned)', () => {
	const PENDING = (digest: string) => JSON.stringify({ type: 'opentimestamps', digest, receipt: 'cA==', anchoredAt: null });

	async function cron(secret: string | null = 'test-cron-secret') {
		const { GET } = await import('../../src/pages/api/cron/upgrade-anchors');
		const headers: Record<string, string> = secret ? { 'x-cron-secret': secret } : {};
		const res: Response = await (GET as any)({ request: new Request('https://almstins.com/api/cron/upgrade-anchors', { headers }) });
		return { status: res.status, body: await res.json() };
	}

	it('refuses a missing or wrong secret', async () => {
		expect(await cron(null)).toEqual({ status: 401, body: { ok: false, error: 'unauthorized' } });
		expect((await cron('nope')).status).toBe(401);
	});

	it('persists a receipt only once Bitcoin confirmed it, and counts failures', async () => {
		fake.rows('receivables')[0].anchor_json = PENDING('aa');
		fake.seed('receivable_claims', {
			id: 'claim-1', receivable_id: RID, tenant_id: LENDER, financier: 'L', amount: 1, currency: 'USD',
			claim_date: '2026-09-02', status: 'active', manifest_json: '{}', digest: 'e'.repeat(64),
			anchor_json: PENDING('bb'), created_at: '2026-09-02 10:00:00',
		});
		fake.seed('receivable_attestations', {
			id: 'att-1', receivable_id: RID, tenant_id: OWNER, role: 'buyer', label: 'B', statement: 'S',
			attested_at: '2026-09-03', manifest_json: '{}', digest: 'f'.repeat(64), anchor_json: PENDING('cc'),
			created_at: '2026-09-03 10:00:00',
		});
		mem.confirm.add('aa');
		mem.failUpgradeFor.add('cc');
		const { status, body } = await cron();
		expect(status).toBe(200);
		expect(body).toMatchObject({ ok: true, checked: 3, confirmed: 1, failed: 1, pending: 3 });
		expect(typeof body.elapsed_ms).toBe('number');
		expect(JSON.parse(fake.rows('receivables')[0].anchor_json).anchoredAt).toBe('2026-10-10T13:00:00.000Z');
		expect(fake.rows('receivable_claims')[0].anchor_json).toBe(PENDING('bb'));
		expect(fake.rows('receivable_attestations')[0].anchor_json).toBe(PENDING('cc'));
	});
});
