import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { randomBytes } from 'node:crypto';
import { canonicalBytes, digestOf, verifyEd25519 } from '../../src/lib/recordProof/isoSign';

/**
 * POST /api/verify/receivables/claim, end to end through addClaim.
 *
 * The characterization block was written and run green against the ORIGINAL route and registry,
 * before receivables S1 changed anything: the status codes and bodies the desk and the registry
 * page read, and the exact bytes of a claim manifest. S1 must leave every one of them green.
 *
 * The S1 block pins the one server change: a forced claim that really is over the headroom signs
 * acknowledged: ['exceeds_headroom'] into its manifest (src/lib/receivables/acknowledgments.ts),
 * and every other claim keeps today's manifest bytes, with no acknowledged key.
 *
 * S3 changes one thing on purpose: with no fingerprint key the duplicate check cannot run, so a
 * 200 now ends with notices: ['duplicate_check_unavailable']. With a key and every row fingerprinted,
 * a claim that matches nothing answers with exactly the pre-S3 keys (pinned below).
 *
 * The registry runs its real SQL against tests/helpers/receivablesDbFake.ts, with the tenant taken
 * from a stubbed session and a fixed signing seed. No network: the claim route never stamps.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

const mem = vi.hoisted(() => ({
	session: { tenantId: 'tenant-lender', isDemo: false } as { tenantId: string; isDemo: boolean } | null,
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
	OpenTimestampsAnchor: class {
		readonly type = 'opentimestamps';
		async stamp(): Promise<never> { throw new Error('the claim route must not stamp'); }
		async upgrade(): Promise<never> { throw new Error('the claim route must not upgrade'); }
	},
}));

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/receivablesRegistry');

const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const RID = 'c0'.repeat(32);
const SEED_A = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';

function seedReceivable(over: Record<string, unknown> = {}) {
	return fake.seed('receivables', {
		id: RID, tenant_id: OWNER, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: 'INV-0042',
		face: 1000, currency: 'USD', terms: null, due_date: '2026-12-01', acknowledged_at: null,
		rtype: 'invoice', payment_method: null, details_json: null, is_test: true,
		manifest_json: '{}', signature_json: null, digest: 'd'.repeat(64), anchor_json: null,
		settled_at: null, settlement_json: null, settlement_digest: null,
		created_at: '2026-09-01 10:00:00', updated_at: null,
		...over,
	});
}

function seedClaim(amount: number) {
	return fake.seed('receivable_claims', {
		id: 'claim-seeded', receivable_id: RID, tenant_id: 'tenant-first', financier: 'First Lender',
		amount, currency: 'USD', claim_date: '2026-09-02', status: 'active',
		manifest_json: '{}', signature_json: null, digest: 'e'.repeat(64), anchor_json: null,
		discharged_at: null, affirmed_at: null, affirmed_by: null, created_at: '2026-09-02 10:00:00',
	});
}

/** A fresh database and fresh modules: the single-flight ensure starts cold against the new fake. */
async function freshRegistry() {
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
	await reg.ensureReceivablesTables();
}

beforeEach(async () => {
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED_A);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	mem.session = { tenantId: LENDER, isDemo: false };
	await freshRegistry();
});
afterEach(() => { vi.unstubAllEnvs(); });

async function post(body: unknown) {
	const mod = await import('../../src/pages/api/verify/receivables/claim.ts');
	const request = new Request('https://almstins.com/api/verify/receivables/claim', {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
	});
	const res: Response = await (mod.POST as any)({ request });
	return { status: res.status, body: await res.json() };
}

const PINNED_INPUT = { financier: 'Lender Co', amount: 250, date: '2026-10-01' };
const PINNED_MANIFEST_JSON =
	`{"v":1,"kind":"financing_claim","receivableId":"${RID}","financier":"Lender Co","amount":250,"currency":"USD","date":"2026-10-01"}`;

describe('POST /claim (characterization, pinned before S1)', () => {
	it('200 within headroom: the body keys, in order', async () => {
		seedReceivable();
		const { status, body } = await post({ receivableId: RID, financier: 'Lender Co', amount: 250 });
		expect(status).toBe(200);
		// S3: no fingerprint key here, so the 200 ends with the informational notice.
		expect(Object.keys(body)).toEqual(['ok', 'claimId', 'digest', 'signed', 'claimed', 'available', 'face', 'notices']);
		expect(body).toMatchObject({ ok: true, signed: true, claimed: 250, available: 750, face: 1000 });
		expect(body.notices).toEqual(['duplicate_check_unavailable']);
	});

	it('S3: with a key and every row fingerprinted, a claim matching nothing keeps exactly the pre-S3 keys', async () => {
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', randomBytes(32).toString('hex'));
		seedReceivable();
		expect((await reg.startFingerprintBackfill()).state).toBe('complete');
		const { status, body } = await post({ receivableId: RID, ...PINNED_INPUT });
		expect(status).toBe(200);
		expect(Object.keys(body)).toEqual(['ok', 'claimId', 'digest', 'signed', 'claimed', 'available', 'face']);
		expect(fake.rows('receivable_claims')[0].manifest_json).toBe(PINNED_MANIFEST_JSON);
	});

	it('409 exceeds_headroom carries the figures', async () => {
		seedReceivable();
		seedClaim(800);
		const { status, body } = await post({ receivableId: RID, financier: 'Second Lender', amount: 300 });
		expect(status).toBe(409);
		expect(body).toEqual({
			ok: false, error: 'exceeds_headroom',
			message: 'Only 200 of 1000 USD is unencumbered; 800 is already claimed.',
			available: 200, claimed: 800, face: 1000,
		});
		expect(fake.rows('receivable_claims')).toHaveLength(1);
	});

	it('409 diligence_required on a real record with no debtor confirmation and no diligence', async () => {
		seedReceivable({ is_test: false });
		const { status, body } = await post({ receivableId: RID, financier: 'Lender Co', amount: 250 });
		expect(status).toBe(409);
		expect(body).toEqual({
			ok: false, error: 'diligence_required',
			message: 'No debtor confirmation is on record for this receivable. Accept responsibility for having verified it yourself before financing.',
		});
		expect(fake.rows('receivable_claims')).toHaveLength(0);
	});

	it('404 for an unknown receivable; 400 for a missing financier or a non-positive amount', async () => {
		seedReceivable();
		expect(await post({ receivableId: 'ff'.repeat(32), financier: 'Lender Co', amount: 250 })).toEqual({
			status: 404, body: { ok: false, error: 'not_found', message: 'No receivable found for that ID.' },
		});
		expect(await post({ receivableId: RID, financier: '', amount: 250 })).toEqual({
			status: 400, body: { ok: false, error: 'invalid', message: 'A financier name is required.' },
		});
		expect(await post({ receivableId: RID, financier: 'Lender Co', amount: 0 })).toEqual({
			status: 400, body: { ok: false, error: 'invalid', message: 'Claim amount must be a positive number.' },
		});
		expect(fake.rows('receivable_claims')).toHaveLength(0);
	});

	it('401 with no session; 403 for a demo session', async () => {
		seedReceivable();
		mem.session = null;
		expect(await post({ receivableId: RID, financier: 'Lender Co', amount: 250 })).toEqual({
			status: 401, body: { ok: false, error: 'unauthenticated' },
		});
		mem.session = { tenantId: LENDER, isDemo: true };
		expect(await post({ receivableId: RID, financier: 'Lender Co', amount: 250 })).toEqual({
			status: 403, body: { ok: false, error: 'demo_readonly' },
		});
		expect(fake.rows('receivable_claims')).toHaveLength(0);
	});

	it('force as the string "true" over headroom still answers 409', async () => {
		seedReceivable();
		seedClaim(800);
		const { status, body } = await post({ receivableId: RID, financier: 'Second Lender', amount: 300, force: 'true' });
		expect(status).toBe(409);
		expect(body.error).toBe('exceeds_headroom');
		expect(fake.rows('receivable_claims')).toHaveLength(1);
	});

	it('a tenantId in the body is ignored: the row belongs to the session tenant', async () => {
		seedReceivable();
		const { status } = await post({ receivableId: RID, financier: 'Lender Co', amount: 250, tenantId: OWNER });
		expect(status).toBe(200);
		expect(fake.rows('receivable_claims')[0].tenant_id).toBe(LENDER);
	});

	it('the manifest of a claim within headroom, byte for byte', async () => {
		seedReceivable();
		const { status } = await post({ receivableId: RID, ...PINNED_INPUT });
		expect(status).toBe(200);
		const row = fake.rows('receivable_claims')[0];
		expect(row.manifest_json).toBe(PINNED_MANIFEST_JSON);
		expect(row.digest).toBe(digestOf(JSON.parse(row.manifest_json)));
	});
});

describe('POST /claim: the signed headroom acknowledgment (S1)', () => {
	it('a forced claim over headroom signs acknowledged: ["exceeds_headroom"] as the last manifest key', async () => {
		seedReceivable();
		seedClaim(800);
		const { status, body } = await post({ receivableId: RID, ...PINNED_INPUT, force: true });
		expect(status).toBe(200);
		expect(body).toMatchObject({ ok: true, signed: true, claimed: 1050, available: -50, face: 1000 });
		const row = fake.rows('receivable_claims').find((r) => r.id === body.claimId)!;
		const parsed = JSON.parse(row.manifest_json);
		expect(parsed).toEqual({ ...JSON.parse(PINNED_MANIFEST_JSON), acknowledged: ['exceeds_headroom'] });
		expect(Object.keys(parsed).at(-1)).toBe('acknowledged');
		expect(row.manifest_json).toBe(PINNED_MANIFEST_JSON.slice(0, -1) + ',"acknowledged":["exceeds_headroom"]}');
		expect(row.digest).toBe(digestOf(parsed));
		expect(body.digest).toBe(row.digest);
		const sig = JSON.parse(row.signature_json);
		expect(verifyEd25519(canonicalBytes(parsed), sig.signatureHex, sig.publicKeyHex)).toBe(true);
	});

	it('a force within headroom acknowledges nothing: same manifest bytes and digest as an unforced claim', async () => {
		seedReceivable();
		const forced = await post({ receivableId: RID, ...PINNED_INPUT, force: true });
		expect(forced.status).toBe(200);
		const forcedRow = fake.rows('receivable_claims')[0];

		await freshRegistry();
		seedReceivable();
		const plain = await post({ receivableId: RID, ...PINNED_INPUT });
		expect(plain.status).toBe(200);
		const plainRow = fake.rows('receivable_claims')[0];

		expect(forcedRow.manifest_json).toBe(PINNED_MANIFEST_JSON);
		expect(plainRow.manifest_json).toBe(PINNED_MANIFEST_JSON);
		expect(forcedRow.digest).toBe(plainRow.digest);
		expect(forced.body.digest).toBe(plain.body.digest);
		expect(JSON.parse(forcedRow.manifest_json)).not.toHaveProperty('acknowledged');
	});

	it('the 200 and 409 bodies never carry acknowledged', async () => {
		seedReceivable();
		seedClaim(800);
		const unforced = await post({ receivableId: RID, ...PINNED_INPUT });
		expect(unforced.status).toBe(409);
		expect(unforced.body).not.toHaveProperty('acknowledged');
		const stringForce = await post({ receivableId: RID, ...PINNED_INPUT, force: 'true' });
		expect(stringForce.status).toBe(409);
		expect(stringForce.body).not.toHaveProperty('acknowledged');
		const forced = await post({ receivableId: RID, ...PINNED_INPUT, force: true });
		expect(forced.status).toBe(200);
		expect(forced.body).not.toHaveProperty('acknowledged');
		expect(Object.keys(forced.body)).toEqual(['ok', 'claimId', 'digest', 'signed', 'claimed', 'available', 'face', 'notices']);
	});
});
