import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * GET /api/verify/receivables/proof-file: one record's proof file, for the tenant that owns it.
 * Records are made by the registry itself over its real SQL (tests/helpers/receivablesDbFake.ts);
 * the session is stubbed and no calendar is called. The key is a fixed test seed that signs
 * nothing outside this suite; all names and amounts are invented.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));
const mem = vi.hoisted(() => ({ session: null as { tenantId: string; isDemo: boolean } | null }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
vi.mock('@/lib/receivables/server/fingerprintBackfill', () => ({
	kickFingerprintBackfill: () => {},
	backfillWithin: async () => ({ fingerprints: 'off' }),
}));
vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
	OpenTimestampsAnchor: class {
		readonly type = 'opentimestamps';
		async stamp(): Promise<never> { throw new Error('no stamping here'); }
		async upgrade(): Promise<never> { throw new Error('no upgrading here'); }
	},
}));

const SEED = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';
const PUB = 'e6affd1a7c9d0f4d874d4883c67b9252313af956180eab8458c05bc72f0b8455';
const KID = 'almstins-9a753ae29c493b1c';
const OWNER = 'tenant-owner';
const OTHER = 'tenant-other';
const INVOICE = { supplier: 'Example Supplier Co', buyer: 'Example Buyer Co', invoiceNo: 'TEST-0042', face: 1000, currency: 'USD', isTest: true };

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/receivablesRegistry');

beforeEach(async () => {
	vi.resetModules();
	vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
	fake = createReceivablesDbFake();
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
	await reg.ensureReceivablesTables();
	mem.session = { tenantId: OWNER, isDemo: false };
});
afterEach(() => { vi.unstubAllEnvs(); });

async function get(query: string) {
	const mod: any = await import('../../src/pages/api/verify/receivables/proof-file.ts');
	const request = new Request(`https://almstins.com/api/verify/receivables/proof-file?${query}`);
	const res: Response = await mod.GET({ request });
	return { res, status: res.status, body: await res.json() };
}

async function created() {
	const r = await reg.createReceivable(OWNER, INVOICE as any);
	if (!r.ok) throw new Error(JSON.stringify(r));
	return r;
}

describe('GET /api/verify/receivables/proof-file', () => {
	it('gives the owner the stored manifest, its digest, the signature with its key, and the .ots', async () => {
		const r = await created();
		const row = fake.rows('receivables').find((x) => x.id === r.id)!;
		row.anchor_json = JSON.stringify({ type: 'opentimestamps', digest: r.digest, receipt: 'b3RzLWJ5dGVz', anchoredAt: '2026-03-01T10:00:00.000Z' });

		const { res, status, body } = await get(`kind=receivable&id=${r.id}`);
		expect(status).toBe(200);
		expect(res.headers.get('content-disposition')).toBe(`attachment; filename="almstins-receivable-${r.digest.slice(0, 12)}.proof.json"`);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(body.proof_format).toBe('almstins-signed-record/v1');
		expect(body.manifest).toEqual(JSON.parse(row.manifest_json));
		// Nothing re-signed or re-shaped: the manifest still hashes to the id it was created under.
		const { canonicalManifestBytes } = await import('../../src/lib/recordProof/signing');
		expect(createHash('sha256').update(canonicalManifestBytes(body.manifest)).digest('hex')).toBe(r.id);
		expect(body.digest).toBe(r.digest);
		expect(body.signature).toEqual({ alg: 'Ed25519', key_id: KID, public_key_hex: PUB, signature_hex: JSON.parse(row.signature_json).signatureHex });
		expect(body.anchor).toEqual({ type: 'opentimestamps', digest: r.digest, ots_base64: 'b3RzLWJ5dGVz', bitcoin_time: '2026-03-01T10:00:00.000Z' });
		expect(body.signature_checkpoint).toBeNull();
		expect(body.key_log.url).toBe('https://github.com/dstr88/almstins-keys');
	});

	it('is the owner\'s only: another account, or no session, gets nothing', async () => {
		const r = await created();
		mem.session = { tenantId: OTHER, isDemo: false };
		expect((await get(`kind=receivable&id=${r.id}`)).status).toBe(404);
		mem.session = null;
		expect((await get(`kind=receivable&id=${r.id}`)).status).toBe(401);
	});

	it('every read is scoped by tenant_id', async () => {
		const r = await created();
		const before = fake.log.length;
		await get(`kind=receivable&id=${r.id}`);
		const reads = fake.log.slice(before).filter((s) => /^SELECT manifest_json/.test(s.sql));
		expect(reads).toHaveLength(1);
		expect(reads[0].sql).toMatch(/WHERE id = \? AND tenant_id = \?/);
		expect(reads[0].args).toEqual([r.id, OWNER]);
	});

	it('refuses an unknown kind and never hands out a file that would fail its own check', async () => {
		const r = await created();
		expect((await get(`kind=constructor&id=${r.id}`)).status).toBe(400);
		expect((await get('kind=receivable&id=')).status).toBe(400);
		fake.rows('receivables').find((x) => x.id === r.id)!.manifest_json = JSON.stringify({ edited: true });
		expect((await get(`kind=receivable&id=${r.id}`)).body).toEqual({ ok: false, error: 'record_unreadable' });
	});

	it('an anchor for a different digest is left out, not passed along', async () => {
		const r = await created();
		fake.rows('receivables').find((x) => x.id === r.id)!.anchor_json = JSON.stringify({ type: 'opentimestamps', digest: 'f'.repeat(64), receipt: 'eA==', anchoredAt: null });
		expect((await get(`kind=receivable&id=${r.id}`)).body.anchor).toBeNull();
	});
});

describe('listOwnProofRecords: what the lookup offers for download', () => {
	const LENDER = 'tenant-lender';
	function seedClaim(receivableId: string, id: string, tenantId: string, over: Record<string, unknown> = {}) {
		return fake.seed('receivable_claims', {
			id, receivable_id: receivableId, tenant_id: tenantId, financier: 'Example Lender', amount: 400, currency: 'USD',
			claim_date: '2026-09-02', status: 'active', manifest_json: '{}', signature_json: null,
			digest: 'e'.repeat(64), anchor_json: null, discharged_at: null, discharge_json: null,
			discharge_digest: null, discharge_reason: null, affirmed_at: null, affirmed_by: null,
			created_at: '2026-09-02 10:00:00',
			...over,
		});
	}

	it('the owner of a receivable gets it and its settlement, never a lender\'s claim', async () => {
		const r = await created();
		seedClaim(r.id, 'claim-lender', LENDER);
		expect(await reg.settleReceivable(OWNER, r.id)).toMatchObject({ ok: true });
		expect(await reg.listOwnProofRecords(r.id, OWNER)).toEqual([
			{ kind: 'receivable', id: r.id },
			{ kind: 'settlement', id: r.id },
		]);
	});

	it('a lender gets its own claim and the claim\'s release, never the receivable', async () => {
		const r = await created();
		seedClaim(r.id, 'claim-lender', LENDER, { discharge_json: '{}', discharge_digest: 'a'.repeat(64), discharged_at: '2026-09-09', status: 'discharged' });
		seedClaim(r.id, 'claim-someone-else', 'tenant-third');
		expect(await reg.listOwnProofRecords(r.id, LENDER)).toEqual([
			{ kind: 'claim', id: 'claim-lender' },
			{ kind: 'claim_discharge', id: 'claim-lender' },
		]);
	});

	it('leaves out records with nothing signed to hand out, and records on another receivable', async () => {
		const r = await created();
		const other = await reg.createReceivable(OWNER, { ...INVOICE, invoiceNo: 'TEST-0043' } as any);
		if (!other.ok) throw new Error('second receivable');
		seedClaim(other.id, 'claim-elsewhere', LENDER);
		expect(await reg.listOwnProofRecords(r.id, LENDER)).toEqual([]);
		// Never settled: no settlement manifest, so no settlement row.
		expect((await reg.listOwnProofRecords(r.id, OWNER)).map((x) => x.kind)).toEqual(['receivable']);
	});

	it('nothing for no tenant, and every read is scoped by tenant_id', async () => {
		const r = await created();
		expect(await reg.listOwnProofRecords(r.id, null)).toEqual([]);
		const before = fake.log.length;
		await reg.listOwnProofRecords(r.id, OWNER);
		const reads = fake.log.slice(before).filter((s) => /^SELECT id FROM/.test(s.sql));
		expect(reads.length).toBeGreaterThanOrEqual(5);
		for (const s of reads) {
			expect(s.sql).toMatch(/AND tenant_id = \? AND/);
			expect(s.args).toEqual([r.id, OWNER]);
		}
	});

	it('every record it lists for the owner downloads', async () => {
		const r = await created();
		await reg.settleReceivable(OWNER, r.id);
		for (const { kind, id } of await reg.listOwnProofRecords(r.id, OWNER)) {
			const { status, body } = await get(`kind=${kind}&id=${id}`);
			expect(status).toBe(200);
			expect(body.kind).toBe(kind);
		}
	});
});
