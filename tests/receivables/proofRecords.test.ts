import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { proofFileHref, proofRowLabel, readProofRows } from '../../src/lib/receivables/proofRecordView';

/**
 * "Your signed records" (receivables downloads, Part A): GET /api/verify/receivables/proof-records
 * lists the signed records the caller's own account holds on one receivable, and every one of
 * them downloads through the existing proof-file route. Records are made by the registry itself
 * over its real SQL (tests/helpers/receivablesDbFake.ts); the session is stubbed. All names and
 * amounts are invented.
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
const OWNER = 'tenant-owner';
const SECOND = 'tenant-second';
const INVOICE = { supplier: 'Example Supplier Co', buyer: 'Example Buyer Co', invoiceNo: 'TEST-0077', face: 1000, currency: 'USD', isTest: true };

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

async function list(receivableId: string) {
	const mod: any = await import('../../src/pages/api/verify/receivables/proof-records.ts');
	const res: Response = await mod.GET({ request: new Request(`https://almstins.com/api/verify/receivables/proof-records?receivableId=${encodeURIComponent(receivableId)}`) });
	return { status: res.status, body: await res.json() };
}

async function proofFile(kind: string, id: string) {
	const mod: any = await import('../../src/pages/api/verify/receivables/proof-file.ts');
	const res: Response = await mod.GET({ request: new Request(`https://almstins.com/api/verify/receivables/proof-file?kind=${kind}&id=${encodeURIComponent(id)}`) });
	return { status: res.status, body: await res.json() };
}

/** A receivable recorded by OWNER, a claim by each firm, and an answer filed under each. */
async function deal() {
	const r = await reg.createReceivable(OWNER, INVOICE as any);
	if (!r.ok) throw new Error(JSON.stringify(r));
	const own = await reg.addClaim(OWNER, r.id, { financier: 'Owner Lender', amount: 400 });
	const theirs = await reg.addClaim(SECOND, r.id, { financier: 'Second Lender', amount: 300 });
	if (!own.ok || !theirs.ok) throw new Error('claims');
	await reg.addAttestation(OWNER, r.id, { role: 'buyer', label: 'Example Buyer Co', statement: 'We owe this invoice.', source: 'party_statement' });
	await reg.addAttestation(SECOND, r.id, { role: 'supplier', label: 'Second Lender', statement: 'A note.', source: 'party_statement' });
	return { id: r.id, ownClaim: own.claimId, theirClaim: theirs.claimId };
}

describe('GET /api/verify/receivables/proof-records', () => {
	it('lists only the records the caller\'s own account holds', async () => {
		const d = await deal();
		const { status, body } = await list(d.id);
		expect(status).toBe(200);
		const kinds = body.records.map((r: any) => `${r.kind}:${r.id === d.id ? 'rcv' : r.id === d.ownClaim ? 'own' : r.id === d.theirClaim ? 'theirs' : 'other'}`);
		expect(kinds).toContain('receivable:rcv');
		expect(kinds).toContain('claim:own');
		expect(kinds).not.toContain('claim:theirs');
		expect(body.records.filter((r: any) => r.kind === 'attestation')).toHaveLength(1);
		expect(JSON.stringify(body)).not.toContain('Second Lender');
	});

	it('the second firm sees its own claim and answer, not the receivable it did not record', async () => {
		const d = await deal();
		mem.session = { tenantId: SECOND, isDemo: false };
		const { body } = await list(d.id);
		const kinds = body.records.map((r: any) => r.kind);
		expect(kinds).not.toContain('receivable');
		expect(body.records.find((r: any) => r.kind === 'claim').id).toBe(d.theirClaim);
		expect(JSON.stringify(body)).not.toContain('Owner Lender');
	});

	it('every listed record downloads through proof-file for the same account', async () => {
		const d = await deal();
		const { body } = await list(d.id);
		expect(body.records.length).toBeGreaterThan(0);
		for (const r of body.records) {
			const f = await proofFile(r.kind, r.id);
			expect(f.status).toBe(200);
			expect(f.body.proof_format).toBe('almstins-signed-record/v1');
		}
	});

	it('every read is scoped by tenant_id', async () => {
		const d = await deal();
		const before = fake.log.length;
		await list(d.id);
		const reads = fake.log.slice(before).filter((s) => /^SELECT/.test(s.sql.trim()) && /receivable/.test(s.sql) && !/information_schema/i.test(s.sql));
		expect(reads.length).toBeGreaterThanOrEqual(5);
		for (const q of reads) {
			expect(q.sql).toMatch(/tenant_id = \?/);
			expect(q.args).toContain(OWNER);
		}
	});

	it('no session gets nothing; a missing id is refused', async () => {
		const d = await deal();
		mem.session = null;
		expect((await list(d.id)).status).toBe(401);
		mem.session = { tenantId: OWNER, isDemo: false };
		expect((await list('')).status).toBe(400);
	});
});

describe('how a row reads', () => {
	it('labels each kind and points at the owner-only download', () => {
		const rows = readProofRows({ ok: true, records: [
			{ kind: 'receivable', id: 'r1', at: '2026-11-28T10:00:00Z', detail: {} },
			{ kind: 'claim', id: 'c1', at: null, detail: { financier: 'Owner Lender', amount: 400, currency: 'USD' } },
			{ kind: 'attestation', id: 'a1', at: null, detail: { role: 'buyer', label: 'Example Buyer Co', disputed: 0 } },
			{ kind: 'attestation', id: 'a2', at: null, detail: { role: 'buyer', label: 'Example Buyer Co', disputed: 1 } },
			{ kind: 'status_event', id: 's1', at: null, detail: { event: 'extended' } },
			{ kind: 'constructor', id: 'x', at: null, detail: {} },
		] })!;
		expect(rows.map(proofRowLabel)).toEqual([
			'The receivable, as recorded',
			'Claim: Owner Lender, USD 400.00',
			'Answer from the debtor (Example Buyer Co)',
			'Dispute from the debtor (Example Buyer Co)',
			'Status update: due date extended',
		]);
		expect(proofFileHref(rows[1])).toBe('/api/verify/receivables/proof-file?kind=claim&id=c1');
	});

	it('a reply that is not ok reads as nothing to show', () => {
		expect(readProofRows({ ok: false })).toBeNull();
		expect(readProofRows(null)).toBeNull();
	});
});
