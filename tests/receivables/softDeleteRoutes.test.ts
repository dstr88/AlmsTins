import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { ADD_RECEIVABLE_DELETED_AT } from '../../src/lib/receivables/schema';

/**
 * Receivables S2 routes, called directly with a stubbed session over the registry's real SQL
 * (tests/helpers/receivablesDbFake.ts):
 *   - every new write on a withdrawn record answers 410 { error: 'withdrawn', message, withdrawnAt };
 *   - DELETE answers 200 { withdrawn, withdrawnAt } (again on a repeat), 404 for anyone but the
 *     owner, and 503 while the deleted_at column is not confirmed;
 *   - POST with the same details restores the owner's record (200, restored: true);
 *   - another party's receipt link on its own claim stays answerable (countersign 200);
 *   - the owner still lists the record's files, as tombstones (document GET 200);
 *   - a tenant ID sent in the body is ignored everywhere: the session decides.
 * No network: the timestamp client is replaced, and no 410 path reaches it.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));
const mem = vi.hoisted(() => ({
	session: null as { tenantId: string; isDemo: boolean } | null,
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
// S3: the create route reads the viewer's tier and nudges the fingerprint backfill; neither is
// under test here.
vi.mock('@/lib/receivables/server/viewerTier', () => ({ isVerifiedViewer: async () => true }));
vi.mock('@/lib/receivables/server/fingerprintBackfill', () => ({
	kickFingerprintBackfill: () => {},
	backfillWithin: async () => ({ fingerprints: 'off' }),
}));
vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
	OpenTimestampsAnchor: class {
		readonly type = 'opentimestamps';
		async stamp(): Promise<never> { throw new Error('a withdrawn write must not stamp'); }
		async upgrade(): Promise<never> { throw new Error('a withdrawn write must not upgrade'); }
	},
}));

let fake: ReceivablesDbFake;
const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const RID = 'c0'.repeat(32);
const BASE = 'https://almstins.com/api/verify/receivables';
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

async function load(options: Parameters<typeof createReceivablesDbFake>[0] = {}) {
	vi.resetModules();
	fake = createReceivablesDbFake(options);
	holder.db = fake;
	await (await import('../../src/lib/receivablesRegistry')).ensureReceivablesTables();
}

function seedRecord() {
	fake.seed('receivables', {
		id: RID, tenant_id: OWNER, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: 'INV-0042',
		face: 1000, currency: 'USD', is_test: true, manifest_json: '{}', signature_json: null,
		digest: 'd'.repeat(64), anchor_json: null, settled_at: null, created_at: '2026-09-01 10:00:00',
	});
	fake.seed('receivable_claims', {
		id: 'claim-lender', receivable_id: RID, tenant_id: LENDER, financier: 'Lender Co', amount: 400,
		currency: 'USD', claim_date: '2026-09-02', status: 'active', manifest_json: '{}', signature_json: null,
		digest: 'e'.repeat(64), anchor_json: null, created_at: '2026-09-02 10:00:00',
	});
}

const as = (tenantId: string | null) => { mem.session = tenantId ? { tenantId, isDemo: false } : null; };

async function call(route: string, method: string, opts: { body?: unknown; form?: FormData; query?: string } = {}) {
	const mod: any = await import(`../../src/pages/api/verify/receivables/${route}.ts`);
	const url = new URL(`${BASE}${route === 'index' ? '' : `/${route}`}${opts.query ?? ''}`);
	const request = opts.form
		? new Request(url, { method, body: opts.form })
		: new Request(url, {
			method,
			headers: { 'content-type': 'application/json' },
			body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
		});
	const res: Response = await mod[method]({ request, url });
	return { status: res.status, body: await res.json() };
}

async function withdraw(): Promise<string> {
	as(OWNER);
	const r = await call('index', 'DELETE', { query: `?id=${RID}` });
	expect(r.status).toBe(200);
	return r.body.withdrawnAt;
}

beforeEach(async () => {
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_KEY', '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60');
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	await load();
	seedRecord();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('DELETE /api/verify/receivables withdraws', () => {
	it('200 { ok, withdrawn, withdrawnAt }, and the same answer on a repeat', async () => {
		as(OWNER);
		const first = await call('index', 'DELETE', { query: `?id=${RID}` });
		expect(first).toEqual({ status: 200, body: { ok: true, withdrawn: true, withdrawnAt: expect.stringMatching(STAMP) } });
		expect(fake.rows('receivables')).toHaveLength(1);
		const again = await call('index', 'DELETE', { body: { id: RID } });
		expect(again).toEqual(first);
	});

	it('404 for anyone but the owner, whatever tenantId the body names', async () => {
		as(LENDER);
		expect(await call('index', 'DELETE', { body: { id: RID, tenantId: OWNER } })).toEqual({ status: 404, body: { ok: false, error: 'not_found' } });
		expect(fake.rows('receivables')[0].deleted_at ?? null).toBeNull();
	});

	it('401 signed out, 403 demo', async () => {
		as(null);
		expect((await call('index', 'DELETE', { query: `?id=${RID}` })).status).toBe(401);
		mem.session = { tenantId: OWNER, isDemo: true };
		expect(await call('index', 'DELETE', { query: `?id=${RID}` })).toEqual({ status: 403, body: { ok: false, error: 'demo_readonly' } });
		expect(fake.rows('receivables')[0].deleted_at ?? null).toBeNull();
	});

	it('503 unavailable while the deleted_at column is not confirmed, and nothing is removed', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await load({ failDdl: (sql) => sql === ADD_RECEIVABLE_DELETED_AT });
		seedRecord();
		as(OWNER);
		expect(await call('index', 'DELETE', { query: `?id=${RID}` })).toEqual({ status: 503, body: { ok: false, error: 'unavailable' } });
		expect(fake.rows('receivables')).toHaveLength(1);
		expect(fake.statements(/^(DELETE|UPDATE) /)).toEqual([]);
	});
});

describe('POST /api/verify/receivables restores the same tenant\'s record', () => {
	const INPUT = { supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'INV-7', face: 2500, currency: 'USD', isTest: true };

	it('200 with restored: true; another tenant gets 409 id_collision even after the withdrawal', async () => {
		as(OWNER);
		const created = await call('index', 'POST', { body: INPUT });
		expect(created.status).toBe(200);
		expect(created.body).not.toHaveProperty('restored');
		const id = created.body.id;
		expect((await call('index', 'DELETE', { query: `?id=${id}` })).status).toBe(200);

		as(LENDER);
		const collision = await call('index', 'POST', { body: { ...INPUT, tenantId: OWNER } });
		expect(collision.status).toBe(409);
		expect(collision.body.error).toBe('id_collision');

		as(OWNER);
		const back = await call('index', 'POST', { body: INPUT });
		expect(back).toEqual({ status: 200, body: { ...created.body, restored: true } });
		const list = await call('index', 'GET');
		expect(list.body.receivables.map((r: any) => r.id)).toContain(id);
	});
});

describe('new writes on a withdrawn record answer 410', () => {
	let withdrawnAt: string;
	beforeEach(async () => { withdrawnAt = await withdraw(); });

	const gone = () => ({
		status: 410,
		body: {
			ok: false, error: 'withdrawn', withdrawnAt,
			message: `This receivable was withdrawn on ${withdrawnAt.slice(0, 10)} by whoever recorded it. Almstins no longer records new claims, statements, requests or files on it. Everything already on file stays there.`,
		},
	});

	it('claim', async () => {
		as(LENDER);
		expect(await call('claim', 'POST', { body: { receivableId: RID, financier: 'Lender Co', amount: 100, tenantId: OWNER } })).toEqual(gone());
		expect(fake.rows('receivable_claims')).toHaveLength(1);
	});

	it('attest', async () => {
		as(LENDER);
		expect(await call('attest', 'POST', { body: { receivableId: RID, role: 'supplier', label: 'Lender Co', statement: 'A note.', tenantId: OWNER } })).toEqual(gone());
		expect(fake.rows('receivable_attestations')).toHaveLength(0);
	});

	it('diligence-accept, before any timestamp', async () => {
		as(LENDER);
		expect(await call('diligence-accept', 'POST', { body: { receivableId: RID, financier: 'Lender Co', method: 'phone', tenantId: OWNER } })).toEqual(gone());
		expect(fake.rows('receivable_attestations')).toHaveLength(0);
	});

	it('reverify (Verify now)', async () => {
		as(LENDER);
		expect(await call('reverify', 'POST', { body: { receivableId: RID, tenantId: OWNER } })).toEqual(gone());
		expect(fake.rows('receivable_reverifications')).toHaveLength(0);
	});

	it('invite create, by the owner; anyone else keeps 404', async () => {
		as(OWNER);
		expect(await call('invite', 'POST', { body: { role: 'buyer', receivableId: RID, email: 'ap@debtor.test' } })).toEqual(gone());
		as(LENDER);
		expect(await call('invite', 'POST', { body: { role: 'buyer', receivableId: RID, tenantId: OWNER } })).toEqual({ status: 404, body: { ok: false, error: 'not_found' } });
		expect(await call('invite', 'POST', { body: { role: 'borrower', claimId: 'claim-lender' } })).toEqual(gone());
		expect(fake.rows('receivable_invites')).toHaveLength(0);
	});

	it('offer, by the owner; anyone else keeps 404', async () => {
		as(OWNER);
		expect(await call('offer', 'POST', { body: { receivableId: RID, financier: 'Owner Capital', amount: 100, recourse: 'recourse' } })).toEqual(gone());
		as(LENDER);
		expect(await call('offer', 'POST', { body: { receivableId: RID, financier: 'Lender Co', amount: 100, tenantId: OWNER } })).toEqual({ status: 404, body: { ok: false, error: 'not_found' } });
		expect(fake.rows('receivable_offers')).toHaveLength(0);
	});

	it('document upload, by the owner; anyone else keeps 404', async () => {
		const form = (tenantId?: string) => {
			const f = new FormData();
			f.set('receivableId', RID);
			if (tenantId) f.set('tenantId', tenantId);
			f.set('file', new File([new Uint8Array([37, 80, 68, 70])], 'note.pdf', { type: 'application/pdf' }));
			return f;
		};
		as(OWNER);
		expect(await call('document', 'POST', { form: form() })).toEqual(gone());
		as(LENDER);
		const other = await call('document', 'POST', { form: form(OWNER) });
		expect(other.status).toBe(404);
		expect(other.body.error).toBe('not_found');
		expect(fake.rows('receivable_documents')).toHaveLength(0);
	});

	it('settle, by the owner; anyone else keeps 404', async () => {
		as(OWNER);
		expect(await call('settle', 'POST', { body: { receivableId: RID } })).toEqual(gone());
		as(LENDER);
		expect((await call('settle', 'POST', { body: { receivableId: RID, tenantId: OWNER } })).status).toBe(404);
		expect(fake.rows('receivables')[0].settled_at).toBeNull();
	});

	it('discharge still works for the claim\'s own tenant', async () => {
		as(LENDER);
		const r = await call('discharge', 'POST', { body: { claimId: 'claim-lender' } });
		expect(r.status).toBe(200);
		expect(r.body).toMatchObject({ ok: true, face: 1000, claimed: 0, available: 1000 });
	});

	it("a claimant's receipt link stays answerable: it confirms or contests a claim already on the record", async () => {
		fake.seed('receivable_invites', {
			token: 'tok-lender', receivable_id: null, from_tenant: LENDER, role: 'borrower', label: null, email: null,
			expires_at: '2099-01-01 00:00:00', accepted_at: null, accepted_by: null, revoked_at: null,
			claim_id: 'claim-lender', offer_id: null, created_at: '2026-09-04 10:00:00',
		});
		as(null);
		const read = await call('countersign', 'GET', { query: '?t=tok-lender' });
		expect(read.status).toBe(200);
		expect(read.body).toMatchObject({ ok: true, receivableId: RID, claimId: 'claim-lender', amount: 400 });
		const answer = await call('countersign', 'POST', { body: { token: 'tok-lender', outcome: 'not_received', by: 'Client' } });
		expect(answer.status).toBe(200);
		expect(answer.body).toMatchObject({ ok: true, claimId: 'claim-lender', receivableId: RID });
		expect(fake.rows('receivable_invites')[0].accepted_at).toMatch(STAMP);
		expect(fake.rows('receivable_attestations')).toEqual([expect.objectContaining({ tenant_id: LENDER, source: 'receipt_dispute' })]);
	});
});

describe('GET /api/verify/receivables/document on a withdrawn record', () => {
	beforeEach(async () => {
		fake.seed('receivable_documents', {
			id: 'doc-1', receivable_id: RID, tenant_id: OWNER, filename: 'promissory-note.pdf', mime_type: 'application/pdf',
			file_size: 5, sha256: 'b'.repeat(64), data: Buffer.from('hello').toString('base64'),
			uploaded_at: '2026-09-06 10:00:00', purged_at: null,
		});
	});

	it('the owner still lists the files, each as its tombstone with the time it was removed', async () => {
		const withdrawnAt = await withdraw();
		as(OWNER);
		expect(await call('document', 'GET', { query: `?receivableId=${RID}` })).toEqual({
			status: 200,
			body: {
				ok: true,
				documents: [{
					id: 'doc-1', filename: 'promissory-note.pdf', mimeType: 'application/pdf', fileSize: 5,
					sha256: 'b'.repeat(64), uploadedAt: '2026-09-06 10:00:00', purgedAt: withdrawnAt,
				}],
			},
		});
	});

	it('anyone else keeps 404, whatever tenantId the query names', async () => {
		await withdraw();
		as(LENDER);
		expect(await call('document', 'GET', { query: `?receivableId=${RID}&tenantId=${OWNER}` })).toEqual({ status: 404, body: { ok: false, error: 'not_found' } });
		as(null);
		expect((await call('document', 'GET', { query: `?receivableId=${RID}` })).status).toBe(401);
	});

	it('uploads still answer 410 withdrawn for the owner', async () => {
		await withdraw();
		as(OWNER);
		const f = new FormData();
		f.set('receivableId', RID);
		f.set('file', new File([new Uint8Array([37, 80, 68, 70])], 'note.pdf', { type: 'application/pdf' }));
		expect((await call('document', 'POST', { form: f })).status).toBe(410);
	});
});
