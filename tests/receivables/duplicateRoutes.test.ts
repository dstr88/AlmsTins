import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * The duplicate check's routes (S3), called directly over the registry's real SQL
 * (tests/helpers/receivablesDbFake.ts): create (index POST), claim, precheck, reverify and lookup.
 * The session and the viewer's tier are stubbed; the backfill trigger is replaced (the tests run
 * the registry's backfill themselves when they need every row fingerprinted). Keys are generated
 * here. Each test uses its own client address, so no limiter budget leaks between tests.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));
const mem = vi.hoisted(() => ({
	session: null as { tenantId: string; isDemo: boolean } | null,
	verified: true,
	kicks: 0,
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
vi.mock('@/lib/receivables/server/viewerTier', () => ({ isVerifiedViewer: async () => mem.verified }));
vi.mock('@/lib/receivables/server/fingerprintBackfill', () => ({
	kickFingerprintBackfill: () => { mem.kicks++; },
	backfillWithin: async () => ({ fingerprints: 'off' }),
}));
vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
	OpenTimestampsAnchor: class {
		readonly type = 'opentimestamps';
		async stamp(): Promise<never> { throw new Error('no stamping here'); }
		async upgrade(): Promise<never> { throw new Error('no upgrading here'); }
	},
}));

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/receivablesRegistry');
const OWNER = 'tenant-owner';
const RIVAL = 'tenant-rival';
const LENDER = 'tenant-lender';
const BASE = 'https://almstins.com/api/verify/receivables';

let ipSeq = 0;
let ip = '';

async function load() {
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
	await reg.ensureReceivablesTables();
}

beforeEach(async () => {
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', randomBytes(32).toString('hex'));
	// The owner's private copy of a transport document number is encrypted under this key.
	vi.stubEnv('VERIFY_ENTITY_SECRET', randomBytes(32).toString('hex'));
	vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
	mem.session = { tenantId: OWNER, isDemo: false };
	mem.verified = true;
	mem.kicks = 0;
	ip = `203.0.113.${++ipSeq % 250}`;
	await load();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const as = (tenantId: string | null, isDemo = false) => { mem.session = tenantId ? { tenantId, isDemo } : null; };

async function call(route: string, method: string, opts: { body?: unknown; raw?: string; headers?: Record<string, string>; query?: string } = {}) {
	const mod: any = await import(`../../src/pages/api/verify/receivables/${route}.ts`);
	const url = new URL(`${BASE}${route === 'index' ? '' : `/${route}`}${opts.query ?? ''}`);
	// The create requires the transport document answer; these suites are about the duplicate check,
	// so a create body without one says "none" (which never enters a fingerprint). The requirement
	// itself is pinned in its own describe at the end of this file.
	const withAnswer = (b: any) => (route === 'index' && method === 'POST' && b && typeof b === 'object' && !b.details?.transportDoc
		? { ...b, details: { ...(b.details ?? {}), transportDoc: { answer: 'none' } } } : b);
	const body = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(withAnswer(opts.body)));
	const request = new Request(url, {
		method,
		headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(opts.headers ?? {}) },
		body: method === 'GET' ? undefined : body,
	});
	const res: Response = await mod[method]({ request, url, clientAddress: ip });
	return { res, status: res.status, body: await res.json() };
}

const INVOICE = { supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'INV-0042', face: 1000, currency: 'USD', isTest: true };

/** Every key anywhere in a JSON value. */
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
	if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
	else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
	return out;
}

async function createAs(tenant: string, input: Record<string, unknown>) {
	as(tenant);
	const r = await call('index', 'POST', { body: input });
	expect(r.status, JSON.stringify(r.body)).toBe(200);
	return r.body;
}

function claimOn(receivableId: string, tenant = LENDER) {
	fake.seed('receivable_claims', {
		id: `seed-${receivableId.slice(0, 6)}-${tenant}`, receivable_id: receivableId, tenant_id: tenant, financier: 'First Lender',
		amount: 500, currency: 'USD', claim_date: '2026-10-02', status: 'active', manifest_json: '{}', signature_json: null,
		digest: 'e'.repeat(64), anchor_json: null, created_at: '2026-10-02 10:00:00',
	});
}

describe('POST /api/verify/receivables (create)', () => {
	it('a verified account gets the full check and its own matches', async () => {
		const first = await createAs(OWNER, INVOICE);
		const second = await createAs(OWNER, { ...INVOICE, invoiceNo: 'inv 42' });
		expect(second.duplicateCheck).toEqual({ state: 'possible_duplicate', basis: 'invoice_number', encumbered: false, anySettled: false, hasDebtorReference: false });
		expect(second.ownMatches).toEqual([{ id: first.id, invoiceNo: 'INV-0042', withdrawn: false }]);
		expect(mem.kicks).toBe(2);
	});

	it('any other account gets the state alone, on a 200 and on an id_collision', async () => {
		const first = await createAs(OWNER, INVOICE);
		claimOn(first.id);
		mem.verified = false;
		const second = await createAs(OWNER, { ...INVOICE, invoiceNo: 'inv 42' });
		expect(second.duplicateCheck).toEqual({ state: 'possible_duplicate' });
		expect(second).not.toHaveProperty('ownMatches');
		expect(Object.keys(second)).toEqual(['ok', 'id', 'digest', 'signed', 'keyId', 'duplicateCheck']);

		as(RIVAL);
		const collision = await call('index', 'POST', { body: INVOICE });
		expect(collision.status).toBe(409);
		expect(collision.body).toEqual({
			ok: false, error: 'id_collision',
			message: 'A receivable with these exact details is already on record at Almstins under another account.',
			duplicateCheck: { state: 'possible_duplicate' },
		});

		mem.verified = true;
		const detailed = await call('index', 'POST', { body: INVOICE });
		expect(detailed.body.duplicateCheck).toEqual({ state: 'possible_duplicate', basis: 'invoice_number', encumbered: true, anySettled: false, hasDebtorReference: false });
	});

	it('the create still succeeds with no key, and reads unavailable', async () => {
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
		const r = await createAs(OWNER, INVOICE);
		expect(r.duplicateCheck).toEqual({ state: 'unavailable', hasDebtorReference: false });
	});

	it('a tenant ID in the body is ignored, and no answer carries a tenant or a foreign ID', async () => {
		const foreign = await createAs(RIVAL, INVOICE);
		claimOn(foreign.id);
		as(OWNER);
		const r = await call('index', 'POST', { body: { ...INVOICE, invoiceNo: 'INV 42', tenantId: RIVAL } });
		expect(r.status).toBe(200);
		expect(fake.rows('receivables').find((x) => x.id === r.body.id)!.tenant_id).toBe(OWNER);
		const keys = keysDeep(r.body);
		for (const k of ['tenant_id', 'tenantId', 'count', 'twinIds']) expect(keys.has(k), k).toBe(false);
		expect(JSON.stringify(r.body)).not.toContain(foreign.id);
		expect(JSON.stringify(r.body)).not.toContain(RIVAL);
	});

	it('429 with Retry-After past 120 creates an hour for one account', async () => {
		for (let i = 0; i < 120; i++) expect((await call('index', 'POST', { body: {} })).status).toBe(400);
		const over = await call('index', 'POST', { body: INVOICE });
		expect(over.status).toBe(429);
		expect(over.body).toEqual({ ok: false, error: 'rate_limited' });
		expect(Number(over.res.headers.get('retry-after'))).toBe(3600);
		expect(fake.rows('receivables')).toHaveLength(0);
	});

	it('429 with Retry-After past 300 creates an hour from one address, across accounts', async () => {
		for (let i = 0; i < 300; i++) {
			as(`tenant-many-${i % 3}`);
			expect((await call('index', 'POST', { body: {} })).status).toBe(400);
		}
		as('tenant-fresh');
		const over = await call('index', 'POST', { body: INVOICE });
		expect(over.status).toBe(429);
		expect(over.res.headers.get('retry-after')).toBe('3600');
	});

	it('401 and demo 403 come first, before any limiter or nudge', async () => {
		as(null);
		expect((await call('index', 'POST', { body: INVOICE })).status).toBe(401);
		as(OWNER, true);
		expect((await call('index', 'POST', { body: INVOICE })).status).toBe(403);
		expect(mem.kicks).toBe(0);
	});
});

describe('POST /claim: the duplicate warning', () => {
	async function financedPair() {
		const first = await createAs(OWNER, INVOICE);
		claimOn(first.id);
		const second = await createAs(RIVAL, { ...INVOICE, invoiceNo: 'INV 42' });
		as(LENDER);
		return { first, second };
	}

	it('a legacy body still gets 200, with possible_duplicate as a notice, and nothing acknowledged', async () => {
		const { second } = await financedPair();
		const r = await call('claim', 'POST', { body: { receivableId: second.id, financier: 'Lender Co', amount: 100 } });
		expect(r.status).toBe(200);
		expect(Object.keys(r.body)).toEqual(['ok', 'claimId', 'digest', 'signed', 'claimed', 'available', 'face', 'notices']);
		expect(r.body.notices).toEqual(['possible_duplicate']);
		const row = fake.rows('receivable_claims').find((c) => c.id === r.body.claimId)!;
		expect(JSON.parse(row.manifest_json)).not.toHaveProperty('acknowledged');
	});

	it('acceptsWarnings: 409 with the warnings and the public facts, and nothing recorded', async () => {
		const { second } = await financedPair();
		const before = fake.rows('receivable_claims').length;
		const r = await call('claim', 'POST', { body: { receivableId: second.id, financier: 'Lender Co', amount: 100, acceptsWarnings: true } });
		expect(r.status).toBe(409);
		expect(r.body).toEqual({
			ok: false, error: 'possible_duplicate',
			message: 'Another record at Almstins matches this invoice and is recorded as financed. Check with the debtor before you advance. To record your claim anyway, send it again acknowledging possible_duplicate.',
			warnings: ['possible_duplicate'],
			duplicateCheck: { state: 'possible_duplicate', basis: 'invoice_number', encumbered: true, anySettled: false, hasDebtorReference: false },
		});
		expect(fake.rows('receivable_claims')).toHaveLength(before);
	});

	it('an acknowledged resubmit gets 200 and signs acknowledged: ["possible_duplicate"] as the last manifest key', async () => {
		const { first, second } = await financedPair();
		fake.rows('receivables').find((x) => x.id === first.id)!.updated_at = '2026-01-01 00:00:00';
		const r = await call('claim', 'POST', {
			body: { receivableId: second.id, financier: 'Lender Co', amount: 100, date: '2026-10-03', acceptsWarnings: true, acknowledge: ['possible_duplicate'] },
		});
		expect(r.status).toBe(200);
		expect(r.body).not.toHaveProperty('notices');
		const row = fake.rows('receivable_claims').find((c) => c.id === r.body.claimId)!;
		const manifest = JSON.parse(row.manifest_json);
		expect(Object.keys(manifest).at(-1)).toBe('acknowledged');
		expect(manifest.acknowledged).toEqual(['possible_duplicate']);
		// Decision 19: the earlier record's clock moved, so its book shows an unseen update.
		expect(fake.rows('receivables').find((x) => x.id === first.id)!.updated_at).not.toBe('2026-01-01 00:00:00');
	});

	it('acknowledge with exceeds_headroom works like force', async () => {
		const { second } = await financedPair();
		const r = await call('claim', 'POST', {
			body: { receivableId: second.id, financier: 'Lender Co', amount: 5000, acceptsWarnings: true, acknowledge: ['exceeds_headroom', 'possible_duplicate'] },
		});
		expect(r.status).toBe(200);
		const row = fake.rows('receivable_claims').find((c) => c.id === r.body.claimId)!;
		expect(JSON.parse(row.manifest_json).acknowledged).toEqual(['exceeds_headroom', 'possible_duplicate']);
	});

	it('an unknown acknowledgment code answers 400', async () => {
		const { second } = await financedPair();
		const r = await call('claim', 'POST', { body: { receivableId: second.id, financier: 'Lender Co', amount: 100, acknowledge: ['possible_duplicate', 'nope'] } });
		expect(r.status).toBe(400);
		expect(r.body).toEqual({ ok: false, error: 'unknown_acknowledgment', message: 'One or more acknowledgment codes are not recognized.', unknown: ['nope'] });
	});

	it('a match that is not financed raises nothing, even for acceptsWarnings', async () => {
		await createAs(OWNER, INVOICE);
		const second = await createAs(RIVAL, { ...INVOICE, invoiceNo: 'INV 42' });
		as(LENDER);
		const r = await call('claim', 'POST', { body: { receivableId: second.id, financier: 'Lender Co', amount: 100, acceptsWarnings: true } });
		expect(r.status).toBe(200);
		expect(r.body).not.toHaveProperty('notices');
	});

	it('with no key: 200 with duplicate_check_unavailable, never 409, even with acceptsWarnings', async () => {
		const { second } = await financedPair();
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
		for (const extra of [{}, { acceptsWarnings: true }]) {
			const r = await call('claim', 'POST', { body: { receivableId: second.id, financier: 'Lender Co', amount: 10, ...extra } });
			expect(r.status).toBe(200);
			expect(r.body.notices).toEqual(['duplicate_check_unavailable']);
		}
	});

	it('an account that is not verified: 409 on any match with the state alone, financed or not, and the same notice', async () => {
		const first = await createAs(OWNER, INVOICE);
		const second = await createAs(RIVAL, { ...INVOICE, invoiceNo: 'INV 42' });
		as(LENDER);
		mem.verified = false;
		const claim = (extra: Record<string, unknown>) => call('claim', 'POST', { body: { receivableId: second.id, financier: 'Lender Co', amount: 10, ...extra } });
		const unfinanced = await claim({ acceptsWarnings: true });
		expect(unfinanced.status).toBe(409);
		expect(unfinanced.body).toEqual({
			ok: false, error: 'possible_duplicate',
			message: 'Another record at Almstins matches this invoice. Check with the debtor before you advance. To record your claim anyway, send it again acknowledging possible_duplicate.',
			warnings: ['possible_duplicate'],
			duplicateCheck: { state: 'possible_duplicate' },
		});
		claimOn(first.id);
		const financed = await claim({ acceptsWarnings: true });
		expect(financed.status).toBe(409);
		expect(financed.body).toEqual(unfinanced.body);
		const legacy = await claim({});
		expect(legacy.status).toBe(200);
		expect(legacy.body.notices).toEqual(['possible_duplicate']);
		const acknowledged = await claim({ acceptsWarnings: true, acknowledge: ['possible_duplicate'] });
		expect(acknowledged.status).toBe(200);
	});

	it('the 409 carries no tenant and no other record\'s ID', async () => {
		const { first, second } = await financedPair();
		const r = await call('claim', 'POST', { body: { receivableId: second.id, financier: 'Lender Co', amount: 100, acceptsWarnings: true } });
		expect(JSON.stringify(r.body)).not.toContain(first.id);
		expect(keysDeep(r.body).has('tenant_id')).toBe(false);
	});
});

describe('POST /precheck', () => {
	const FIELDS = { supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'inv 42', face: 1000, currency: 'USD', isTest: true };

	it('401 without a session; 403 for the demo account', async () => {
		as(null);
		expect((await call('precheck', 'POST', { body: FIELDS })).body).toEqual({ ok: false, error: 'unauthenticated' });
		as(OWNER, true);
		const demo = await call('precheck', 'POST', { body: FIELDS });
		expect(demo.status).toBe(403);
		expect(demo.body).toEqual({ ok: false, error: 'demo_readonly' });
	});

	it('equals the create\'s answer for the same fields, own matches included, and writes nothing', async () => {
		await createAs(OWNER, INVOICE);
		const other = await createAs(RIVAL, { ...INVOICE, invoiceNo: 'INV 0042' });
		claimOn(other.id);
		as(OWNER);
		const writes = () => fake.statements(/^(INSERT|UPDATE|DELETE) /).length;
		const before = writes();
		const pre = await call('precheck', 'POST', { body: FIELDS });
		expect(pre.status).toBe(200);
		expect(writes()).toBe(before);
		expect(fake.dataBatches()).toEqual([]);
		const created = await call('index', 'POST', { body: FIELDS });
		expect(pre.body).toEqual({ ok: true, duplicateCheck: created.body.duplicateCheck, ownMatches: created.body.ownMatches });
		expect(pre.body.ownMatches).toHaveLength(1);
		expect(pre.body.duplicateCheck).toMatchObject({ state: 'possible_duplicate', encumbered: true });
	});

	it('an unverified account gets the state alone', async () => {
		await createAs(OWNER, INVOICE);
		mem.verified = false;
		const pre = await call('precheck', 'POST', { body: FIELDS });
		expect(pre.body).toEqual({ ok: true, duplicateCheck: { state: 'possible_duplicate' } });
	});

	it('400 when there is not enough to compare', async () => {
		for (const bad of [{ ...FIELDS, buyer: '' }, { ...FIELDS, currency: '' }, { ...FIELDS, invoiceNo: '' }, { ...FIELDS, face: 0 }, {}]) {
			expect((await call('precheck', 'POST', { body: bad })).status).toBe(400);
		}
		expect((await call('precheck', 'POST', { raw: 'not json' })).status).toBe(400);
		expect((await call('precheck', 'POST', { body: { ...FIELDS, invoiceNo: '', details: { buyerRef: 'PO-1' } } })).status).toBe(200);
	});

	it('413 above 4 KB, by the declared length or by the bytes sent', async () => {
		const big = JSON.stringify({ ...FIELDS, supplier: 'x'.repeat(5000) });
		// Declared: the body is small, but the Content-Length says it is over, so nothing is read.
		const declared = await call('precheck', 'POST', { raw: JSON.stringify(FIELDS), headers: { 'content-length': '4097' } });
		expect(declared.status).toBe(413);
		expect(declared.body).toEqual({ ok: false, error: 'too_large' });
		// Sent: no declared length, the bytes pass the cap.
		expect((await call('precheck', 'POST', { raw: big })).status).toBe(413);
		// At the cap exactly: read.
		const atCap = JSON.stringify({ ...FIELDS, supplier: 'Acme Supplies Ltd'.padEnd(4096 - JSON.stringify(FIELDS).length + 'Acme Supplies Ltd'.length, ' ') });
		expect(new TextEncoder().encode(atCap).byteLength).toBe(4096);
		expect((await call('precheck', 'POST', { raw: atCap })).status).toBe(200);
		const mod: any = await import('../../src/pages/api/verify/receivables/precheck.ts');
		const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
		const request = new Request(`${BASE}/precheck`, {
			method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: stream, duplex: 'half',
		} as RequestInit);
		expect(request.headers.get('content-length')).toBeNull();
		expect((await mod.POST({ request, clientAddress: ip })).status).toBe(413);
	});

	it('429 with Retry-After past 60 a minute for one account; no CORS, no-store, JSON', async () => {
		let last: Awaited<ReturnType<typeof call>> | null = null;
		for (let i = 0; i < 61; i++) last = await call('precheck', 'POST', { body: FIELDS });
		expect(last!.status).toBe(429);
		expect(last!.res.headers.get('retry-after')).toBe('60');
		const fresh = await (async () => { as('tenant-other'); ip = '198.51.100.250'; return call('precheck', 'POST', { body: FIELDS }); })();
		expect(fresh.status).toBe(200);
		for (const res of [last!.res, fresh.res]) {
			expect(res.headers.get('access-control-allow-origin')).toBeNull();
			expect(res.headers.get('cache-control')).toBe('no-store');
			expect(res.headers.get('content-type')).toBe('application/json');
		}
	});

	it('429 past 120 a minute from one address, across accounts', async () => {
		for (let i = 0; i < 120; i++) {
			as(`tenant-many-${i % 3}`);
			expect((await call('precheck', 'POST', { body: FIELDS })).status).toBe(200);
		}
		as('tenant-fresh');
		expect((await call('precheck', 'POST', { body: FIELDS })).status).toBe(429);
	});

	it('503 when the store fails, logging a fixed line and never the body', async () => {
		const errors: unknown[][] = [];
		vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a); });
		holder.db = { execute: async () => { throw new Error('connection refused'); }, batch: async () => { throw new Error('x'); } };
		vi.resetModules();
		const r = await call('precheck', 'POST', { body: FIELDS });
		expect(r.status).toBe(503);
		expect(r.body).toEqual({ ok: false, error: 'unavailable' });
		expect(errors).toEqual([['[receivables-precheck] store unavailable']]);
	});

	it('GET answers 405', async () => {
		const mod: any = await import('../../src/pages/api/verify/receivables/precheck.ts');
		const res: Response = await mod.GET({ request: new Request(`${BASE}/precheck`) });
		expect(res.status).toBe(405);
		expect(res.headers.get('allow')).toBe('POST');
	});
});

describe('Verify now and the public lookup', () => {
	it('reverify carries the duplicate row: the financed wording for a verified account, a plain match for any other', async () => {
		const first = await createAs(OWNER, INVOICE);
		claimOn(first.id);
		const second = await createAs(RIVAL, { ...INVOICE, invoiceNo: 'INV 42' });
		as(LENDER);
		const r = await call('reverify', 'POST', { body: { receivableId: second.id } });
		expect(r.status).toBe(200);
		expect(r.body.checks.find((c: any) => c.key === 'duplicate')).toMatchObject({ label: 'Duplicate check', state: 'warn', detail: expect.stringContaining('recorded as financed') });
		expect(r.body.verdict).toBe('attention');

		mem.verified = false;
		const plain = await call('reverify', 'POST', { body: { receivableId: second.id } });
		expect(plain.status).toBe(200);
		expect(plain.body.checks.find((c: any) => c.key === 'duplicate')).toEqual({
			key: 'duplicate', label: 'Duplicate check', state: 'warn', detail: 'Another record at Almstins matches this invoice. Check with the debtor before you advance.',
		});
		expect(plain.body.verdict).toBe('attention');
		expect(JSON.stringify(plain.body)).not.toMatch(/recorded as financed|installment/);
	});

	it('lookup shows the public facts only: the state and whether this record has a debtor reference', async () => {
		const first = await createAs(OWNER, INVOICE);
		claimOn(first.id);
		const second = await createAs(RIVAL, { ...INVOICE, invoiceNo: 'INV 42' });
		as(null);
		const r = await call('lookup', 'GET', { query: `?id=${second.id}` });
		expect(r.status).toBe(200);
		const dup = r.body.receivable.duplicateCheck;
		expect(dup).toEqual({ state: 'possible_duplicate', hasDebtorReference: false });
		expect(JSON.stringify(r.body)).not.toContain(first.id);
		for (const k of ['ownMatches', 'basis', 'encumbered', 'anySettled']) expect(keysDeep(r.body).has(k), k).toBe(false);
		expect(mem.kicks).toBeGreaterThan(0);
	});

	it('an account that is not verified cannot get the financed answer by creating a record and looking it up signed out', async () => {
		// The probe: another tenant's invoice, financed or not, then a throwaway unverified account
		// records a guess at it, gets back the state and the new record's ID, and looks that ID up.
		const probe = async () => {
			as('tenant-probe');
			mem.verified = false;
			const created = await call('index', 'POST', { body: { ...INVOICE, invoiceNo: 'INV 42', terms: `probe ${Math.random()}` } });
			expect(created.status).toBe(200);
			expect(created.body.duplicateCheck).toEqual({ state: 'possible_duplicate' });
			as(null);
			const looked = await call('lookup', 'GET', { query: `?id=${created.body.id}` });
			expect(looked.status).toBe(200);
			return { created: created.body.duplicateCheck, lookup: looked.body.receivable.duplicateCheck };
		};
		as(OWNER);
		mem.verified = true;
		const theirs = await createAs(OWNER, INVOICE);
		const before = await probe();
		claimOn(theirs.id);
		const after = await probe();
		expect(before.lookup).toEqual({ state: 'possible_duplicate', hasDebtorReference: false });
		// Financed or not, every answer the prober can reach is the same.
		expect(after).toEqual(before);
	});
});

describe('GET /receivables (the book)', () => {
	it('lists relation and possibleDuplicate', async () => {
		const mine = await createAs(OWNER, INVOICE);
		await createAs(RIVAL, { ...INVOICE, invoiceNo: 'INV 42' });
		as(OWNER);
		const r = await call('index', 'GET');
		expect(r.body.receivables).toEqual([expect.objectContaining({ id: mine.id, relation: 'owner', possibleDuplicate: true })]);
	});
});

// The transport document question and the shipment key.
describe('the transport document answer and the shipment key', () => {
	const DOC = (number: string) => ({ answer: 'number', type: 'bill_of_lading', number });
	const raw = async (tenant: string, body: Record<string, unknown>) => {
		as(tenant);
		const mod: any = await import('../../src/pages/api/verify/receivables/index.ts');
		const url = new URL(BASE);
		const request = new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body) });
		const res: Response = await mod.POST({ request, url, clientAddress: ip });
		return { status: res.status, body: await res.json() };
	};

	it('a create with no answer, an unknown answer, or "It has a number" with no number is refused, and nothing is written', async () => {
		for (const details of [undefined, {}, { transportDoc: { answer: 'maybe' } }, { transportDoc: { answer: 'number', type: 'bill_of_lading', number: '  ' } }, { transportDoc: { answer: 'number', type: 'ship', number: 'X1' } }]) {
			const r = await raw(OWNER, { ...INVOICE, ...(details ? { details } : {}) });
			expect(r.status).toBe(400);
			expect(r.body).toEqual({
				ok: false, error: 'transport_doc_required',
				message: 'Answer the transport document question: give its number, or say there is none or that it is not known yet.',
			});
		}
		expect(fake.rows('receivables')).toHaveLength(0);
	});

	it('"none" and "not known yet" are signed into the details as given', async () => {
		for (const [i, transportDoc] of [{ answer: 'none' }, { answer: 'not_known' }].entries()) {
			const r = await raw(OWNER, { ...INVOICE, invoiceNo: `INV-${i}`, details: { transportDoc } });
			expect(r.status).toBe(200);
			const row = fake.rows('receivables').find((x) => x.id === r.body.id)!;
			expect(JSON.parse(row.details_json).transportDoc).toEqual(transportDoc);
			expect(JSON.parse(row.manifest_json).receivable.details.transportDoc).toEqual(transportDoc);
			expect(row.transport_doc_owner ?? null).toBeNull();
		}
	});

	it('a number is signed only as a keyed commitment; the readable number is nowhere but the owner\'s encrypted copy', async () => {
		const r = await raw(OWNER, { ...INVOICE, details: { transportDoc: DOC('MAEU 0123-456') } });
		expect(r.status).toBe(200);
		const row = fake.rows('receivables').find((x) => x.id === r.body.id)!;
		const stored = JSON.parse(row.manifest_json).receivable.details.transportDoc;
		expect(stored).toEqual({ answer: 'number', type: 'bill_of_lading', commitment: { kid: expect.stringMatching(/^tdc1-[0-9a-f]{12}$/), mac: expect.stringMatching(/^[0-9a-f]{64}$/) } });
		expect(JSON.parse(row.details_json).transportDoc).toEqual(stored);
		for (const v of [row.details_json, row.manifest_json, row.transport_doc_owner, row.fingerprint_doc]) {
			expect(String(v)).not.toMatch(/MAEU|0123456|0123-456/);
		}
		expect(row.transport_doc_owner).toMatch(/^v1:/);
	});

	it('two invoices on one shipment carry different commitments, so their details alone never show the shared shipment', async () => {
		const a = await createAs(OWNER, { ...INVOICE, details: { transportDoc: DOC('MAEU0123456') } });
		const b = await createAs(OWNER, { ...INVOICE, invoiceNo: 'INV-0099', details: { transportDoc: DOC('MAEU0123456') } });
		const mac = (id: string) => JSON.parse(fake.rows('receivables').find((x) => x.id === id)!.details_json).transportDoc.commitment.mac;
		expect(mac(a.id)).not.toBe(mac(b.id));
	});

	it('without the encryption key a number is refused (503) and nothing is written; "not known yet" still records', async () => {
		vi.stubEnv('VERIFY_ENTITY_SECRET', '');
		const r = await raw(OWNER, { ...INVOICE, details: { transportDoc: DOC('MAEU0123456') } });
		expect(r.status).toBe(503);
		expect(r.body).toEqual({ ok: false, error: 'transport_doc_unavailable', message: 'The transport document number cannot be recorded right now. Pick “Not known yet”, or try again later.' });
		expect(fake.rows('receivables')).toHaveLength(0);
		expect((await raw(OWNER, { ...INVOICE, details: { transportDoc: { answer: 'not_known' } } })).status).toBe(200);
	});

	it('the lookup gives the owner their own copy and nobody else the number', async () => {
		const r = await createAs(OWNER, { ...INVOICE, details: { transportDoc: DOC('B/L MAEU 0123-456') } });
		as(OWNER);
		const own = await call('lookup', 'GET', { query: `?id=${r.id}` });
		expect(own.body.receivable.transportDocNumber).toBe('B/L MAEU 0123-456');
		for (const viewer of [RIVAL, null]) {
			as(viewer);
			const other = await call('lookup', 'GET', { query: `?id=${r.id}` });
			expect(other.body.receivable).not.toHaveProperty('transportDocNumber');
			expect(JSON.stringify(other.body)).not.toMatch(/MAEU|0123456/);
		}
	});

	it('another lender checks a number it holds and gets only a yes or no, with typing differences matching', async () => {
		const r = await createAs(OWNER, { ...INVOICE, details: { transportDoc: DOC('B/L No. MAEU 0123-456') } });
		const none = await createAs(OWNER, { ...INVOICE, invoiceNo: 'INV-7', details: { transportDoc: { answer: 'none' } } });
		as(LENDER);
		const yes = await call('transport-doc-check', 'POST', { body: { receivableId: r.id, number: 'maeu0123456' } });
		expect(yes.status).toBe(200);
		expect(yes.body).toEqual({ ok: true, match: true });
		const no = await call('transport-doc-check', 'POST', { body: { receivableId: r.id, number: 'MAEU0123457' } });
		expect(no.body).toEqual({ ok: true, match: false });
		expect((await call('transport-doc-check', 'POST', { body: { receivableId: none.id, number: 'X1' } })).status).toBe(409);
		expect((await call('transport-doc-check', 'POST', { body: { receivableId: 'ab'.repeat(32), number: 'X1' } })).status).toBe(404);
		as(null);
		expect((await call('transport-doc-check', 'POST', { body: { receivableId: r.id, number: 'maeu0123456' } })).status).toBe(401);
	});

	it('a commitment made under a retired key is still checkable once the key is listed as retired', async () => {
		const oldKey = process.env.RECEIVABLES_FINGERPRINT_KEY!;
		const r = await createAs(OWNER, { ...INVOICE, details: { transportDoc: DOC('MAEU0123456') } });
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', randomBytes(32).toString('hex'));
		as(LENDER);
		expect((await call('transport-doc-check', 'POST', { body: { receivableId: r.id, number: 'MAEU0123456' } })).status).toBe(503);
		vi.stubEnv('RECEIVABLES_FINGERPRINT_RETIRED_KEYS', oldKey);
		expect((await call('transport-doc-check', 'POST', { body: { receivableId: r.id, number: 'MAEU0123456' } })).body).toEqual({ ok: true, match: true });
	});

	it('a reissued invoice against the same bill of lading matches on the shipment alone, at another amount and number', async () => {
		await createAs(OWNER, { ...INVOICE, details: { transportDoc: DOC('B/L No. MAEU 0123-456') } });
		const second = await createAs(RIVAL, { ...INVOICE, invoiceNo: 'INV-0099', face: 1250, details: { transportDoc: DOC('maeu0123456') } });
		expect(second.duplicateCheck).toEqual({ state: 'possible_duplicate', basis: 'same_shipment', encumbered: false, anySettled: false, hasDebtorReference: false });
	});

	it('"none" and "not known yet" never match each other', async () => {
		await createAs(OWNER, { ...INVOICE, details: { transportDoc: { answer: 'none' } } });
		const a = await createAs(RIVAL, { ...INVOICE, invoiceNo: 'INV-0099', details: { transportDoc: { answer: 'none' } } });
		const b = await createAs(RIVAL, { ...INVOICE, invoiceNo: 'INV-0100', details: { transportDoc: { answer: 'not_known' } } });
		expect(a.duplicateCheck.state).toBe('no_match');
		expect(b.duplicateCheck.state).toBe('no_match');
	});

	it('a verified claim on a shipment-only match is asked about, financed or not, with words that never say financed', async () => {
		await createAs(OWNER, { ...INVOICE, details: { transportDoc: DOC('MAEU0123456') } });
		const second = await createAs(RIVAL, { ...INVOICE, invoiceNo: 'INV-0099', face: 1250, details: { transportDoc: DOC('MAEU0123456') } });
		as(LENDER);
		const r = await call('claim', 'POST', { body: { receivableId: second.id, financier: 'Lender Co', amount: 100, acceptsWarnings: true } });
		expect(r.status).toBe(409);
		expect(r.body.error).toBe('possible_duplicate');
		expect(r.body.duplicateCheck.basis).toBe('same_shipment');
		expect(r.body.message).toContain('ask the buyer who owes this invoice which invoices it has for this shipment');
		expect(r.body.message).not.toMatch(/financed|duplicate check|recorded as/i);
	});

	it('the book tags a shipment-only match "same shipment" for a verified account, and sends the flag to no other', async () => {
		await createAs(RIVAL, { ...INVOICE, details: { transportDoc: DOC('MAEU0123456') } });
		const mine = await createAs(OWNER, { ...INVOICE, invoiceNo: 'INV-0099', face: 1250, details: { transportDoc: DOC('MAEU0123456') } });
		as(OWNER);
		const verified = await call('index', 'GET');
		const row = verified.body.receivables.find((x: any) => x.id === mine.id);
		expect(row).toMatchObject({ possibleDuplicate: true, sameShipment: true });
		mem.verified = false;
		const plain = await call('index', 'GET');
		const prow = plain.body.receivables.find((x: any) => x.id === mine.id);
		expect(prow.possibleDuplicate).toBe(true);
		expect(prow).not.toHaveProperty('sameShipment');
	});

	it('Verify now says when the shipment could not be compared because it was not known yet', async () => {
		const r = await createAs(OWNER, { ...INVOICE, details: { buyerRef: 'PO-77', transportDoc: { answer: 'not_known' } } });
		const v = await call('reverify', 'POST', { body: { receivableId: r.id } });
		const row = v.body.checks.find((c: any) => c.key === 'duplicate');
		expect(row).toMatchObject({ state: 'warn', detail: 'The transport document was not known when this receivable was recorded, so the check could not compare the shipment.' });
	});
});
