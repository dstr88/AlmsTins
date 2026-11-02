import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { FOUND_ONLY_KEYS, FULL_ANSWER_KEYS, NEVER_RETURNED } from '../../src/lib/receivables/seenBefore';
import * as copy from '../../src/lib/receivables/copy/seenBefore';

/**
 * POST /api/verify/receivables/check, "Seen before?" (S5), called directly over the registry's real
 * SQL and the store's one SELECT (tests/helpers/receivablesDbFake.ts). The records it finds are made
 * by the registry itself (create, claim, settle, withdraw, a debtor's answer through a request
 * link) under other accounts. The session and the viewer's tier are stubbed; the backfill trigger
 * is replaced. Keys are generated here. Each test uses its own client address, and the route is
 * re-imported per test, so no limiter budget leaks between tests.
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
/** A lender who holds no receivable ID and asks before advancing. */
const ASKER = 'tenant-asker';
const BASE = 'https://almstins.com/api/verify/receivables';
const STORE_SQL = /^SELECT r\.face, /;

let ipSeq = 0;
let ip = '';

async function load(options: Parameters<typeof createReceivablesDbFake>[0] = {}) {
	vi.resetModules();
	fake = createReceivablesDbFake(options);
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
	await reg.ensureReceivablesTables();
}

beforeEach(async () => {
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', randomBytes(32).toString('hex'));
	vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
	mem.session = { tenantId: ASKER, isDemo: false };
	mem.verified = true;
	mem.kicks = 0;
	ip = `203.0.113.${++ipSeq % 250}`;
	await load();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const as = (tenantId: string | null, isDemo = false) => { mem.session = tenantId ? { tenantId, isDemo } : null; };

async function call(route: string, method: string, opts: { body?: unknown; raw?: string; headers?: Record<string, string> } = {}) {
	const mod: any = await import(`../../src/pages/api/verify/receivables/${route}.ts`);
	const url = new URL(`${BASE}/${route}`);
	const body = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
	const request = new Request(url, {
		method,
		headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(opts.headers ?? {}) },
		body: method === 'GET' ? undefined : body,
	});
	const res: Response = await mod[method]({ request, url, clientAddress: ip });
	return { res, status: res.status, body: await res.json() };
}

/** The invoice as its supplier recorded it. */
const INVOICE = { supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'INV-0042', face: 1000, currency: 'USD', isTest: true };
/** The same invoice as a lender types it into the check. */
const CHECK = { invoice: { supplier: 'ACME SUPPLIES LIMITED', buyer: 'Bigco Plc', invoiceNo: 'inv 42', face: 1000, currency: 'usd' }, test: true };
const withInvoice = (over: Record<string, unknown>, test = true) => ({ invoice: { ...CHECK.invoice, ...over }, test });

const check = (body: unknown = CHECK) => call('check', 'POST', { body });

type Created = Extract<Awaited<ReturnType<typeof reg.createReceivable>>, { ok: true }>;
async function create(tenant: string, input: Record<string, unknown>, createdAt?: string): Promise<Created> {
	const r = await reg.createReceivable(tenant, input as any);
	if (!r.ok) throw new Error(`create failed: ${JSON.stringify(r)}`);
	if (createdAt) rowOf(r.id).created_at = createdAt;
	return r;
}
const rowOf = (id: string) => fake.rows('receivables').find((x) => x.id === id)!;

const debtorAnswers = { theirReference: 'PO-00123', by: 'Accounts Payable', goodsReceived: true, amountCorrect: true, noOffsets: true, notAlreadyPaid: true };
/** The debtor's answer through a request link the record's owner sent. */
async function debtorSays(owner: string, receivableId: string, outcome: 'confirmed' | 'not_ours' | 'amount_wrong') {
	const invite = await reg.createInvite(owner, { role: 'buyer', receivableId });
	if (!invite.ok) throw new Error(`invite failed: ${JSON.stringify(invite)}`);
	const r = await reg.confirmByToken(invite.token, outcome, debtorAnswers);
	if (!r.ok) throw new Error(`answer failed: ${JSON.stringify(r)}`);
}

/**
 * Two records of one invoice under two other accounts: the supplier's own, financed in part by a
 * lender, with the debtor's reference; and a second one typed differently, which the debtor
 * disputed. Returns everything that must never leave in an answer.
 */
async function financedPair() {
	const first = await create(RIVAL, { ...INVOICE, details: { buyerRef: 'PO-00123' } }, '2026-09-01 09:00:00');
	const claim = await reg.addClaim(LENDER, first.id, { financier: 'Lender Co', amount: 400 });
	if (!claim.ok) throw new Error(`claim failed: ${JSON.stringify(claim)}`);
	const second = await create(OWNER, { ...INVOICE, invoiceNo: 'INV 42' }, '2026-09-15 09:00:00');
	await debtorSays(OWNER, second.id, 'not_ours');
	const secrets = [
		first.id, second.id, claim.claimId, RIVAL, OWNER, LENDER, 'Lender Co', 'Acme', 'Bigco', 'INV', 'PO-',
		...[first.id, second.id].flatMap((id) => [rowOf(id).fingerprint_inv, rowOf(id).fingerprint_ref, rowOf(id).fingerprint_kid]),
	].filter((s): s is string => typeof s === 'string' && s !== '');
	return { first, second, claim, secrets };
}

/** Every key anywhere in a JSON value. */
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
	if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
	else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
	return out;
}

function expectNoLeak(body: unknown, secrets: string[]) {
	const keys = keysDeep(body);
	for (const k of NEVER_RETURNED) expect(keys.has(k), k).toBe(false);
	const text = JSON.stringify(body);
	for (const s of secrets) expect(text, s).not.toContain(s);
}

function expectPublicHeaders(res: Response) {
	expect(res.headers.get('access-control-allow-origin')).toBeNull();
	expect(res.headers.get('cache-control')).toBe('no-store');
	expect(res.headers.get('content-type')).toBe('application/json');
}

const UNAVAILABLE = { ok: false, error: 'check_unavailable', message: copy.SEEN_BEFORE_UNAVAILABLE };
const SIGN_IN = { ok: false, error: 'unauthenticated', message: copy.SEEN_BEFORE_SIGN_IN, signIn: '/receivables/login?next=%2Freceivables' };

describe('who may ask', () => {
	it('401 with a sign-in prompt without a session, never an answer, a Bearer header included', async () => {
		await financedPair();
		as(null);
		const r = await check();
		expect(r.status).toBe(401);
		expect(r.body).toEqual(SIGN_IN);
		expect(r.body).not.toHaveProperty('found');
		// No agent-key tier in S5: a key changes nothing, and no CORS is offered for one.
		const keyed = await call('check', 'POST', { body: CHECK, headers: { authorization: `Bearer avk_${'0'.repeat(48)}` } });
		expect(keyed.status).toBe(401);
		expect(keyed.body).toEqual(SIGN_IN);
		expectPublicHeaders(keyed.res);
		expect(fake.statements(STORE_SQL)).toEqual([]);
	});

	it('403 for the demo account', async () => {
		await financedPair();
		as(OWNER, true);
		const r = await check();
		expect(r.status).toBe(403);
		expect(r.body).toEqual({ ok: false, error: 'demo_readonly', message: copy.SEEN_BEFORE_DEMO });
		expect(fake.statements(STORE_SQL)).toEqual([]);
	});
});

describe('the answer, by tier', () => {
	it('a verified account gets the full answer, in the documented key order', async () => {
		const { secrets } = await financedPair();
		const before = Date.now();
		const r = await check(withInvoice({ buyerRef: 'po 123' }));
		expect(r.status).toBe(200);
		expect(Object.keys(r.body)).toEqual([...FULL_ANSWER_KEYS]);
		expect(r.body).toEqual({
			v: 1, found: true, matches: 2, status: 'financed', anyFinanced: true, financing: 'partial',
			claimsAffirmed: 'none', anySettled: false, anyStale: false, staleSince: null, debtor: 'disputed', withdrawn: false,
			refChecked: true, refMatch: true, firstSeen: '2026-09-01', test: true, checkedAt: expect.any(String),
		});
		const at = Date.parse(r.body.checkedAt);
		expect(new Date(at).toISOString()).toBe(r.body.checkedAt);
		expect(at).toBeGreaterThanOrEqual(before - 1000);
		expect(at).toBeLessThanOrEqual(Date.now());
		expectNoLeak(r.body, secrets);
		expectPublicHeaders(r.res);
	});

	it('settled, withdrawn and a debtor confirmation; no reference sent', async () => {
		const settled = await create(OWNER, INVOICE, '2026-08-20 09:00:00');
		await debtorSays(OWNER, settled.id, 'confirmed');
		expect(await reg.settleReceivable(OWNER, settled.id)).toMatchObject({ ok: true });
		const withdrawn = await create(RIVAL, { ...INVOICE, invoiceNo: 'INV 42' }, '2026-09-02 09:00:00');
		expect(await reg.deleteReceivable(RIVAL, withdrawn.id)).toMatchObject({ ok: true });
		const r = await check();
		expect(r.body).toEqual({
			v: 1, found: true, matches: 2, status: 'settled', anyFinanced: false, financing: 'none',
			claimsAffirmed: 'none', anySettled: true, anyStale: false, staleSince: null, debtor: 'confirmed', withdrawn: true,
			refChecked: false, refMatch: false, firstSeen: '2026-08-20', test: true, checkedAt: expect.any(String),
		});
	});

	it('an affirmed claim over the face: financing over, claims all affirmed; matches stop at 5', async () => {
		const a = await create(RIVAL, INVOICE, '2026-09-01 09:00:00');
		const claim = await reg.addClaim(LENDER, a.id, { financier: 'Lender Co', amount: 1200, force: true });
		expect(claim).toMatchObject({ ok: true });
		const row = fake.rows('receivable_claims').find((c) => c.receivable_id === a.id)!;
		row.affirmed_at = '2026-09-03 10:00:00';
		for (let i = 0; i < 5; i++) fake.seed('receivables', { ...rowOf(a.id), id: `copy-${i}`, created_at: '2026-09-10 09:00:00' });
		const r = await check();
		expect(r.body).toMatchObject({ found: true, matches: 5, status: 'financed', financing: 'over', claimsAffirmed: 'all', firstSeen: '2026-09-01' });
	});

	it('not on record: found false and status not_found, never a clean bill', async () => {
		await create(RIVAL, INVOICE);
		for (const body of [
			withInvoice({ face: 1000.01 }),
			withInvoice({ currency: 'EUR' }),
			withInvoice({ invoiceNo: 'INV-0043' }),
			// Test with test and real with real.
			withInvoice({}, false),
		]) {
			const r = await check(body);
			expect(r.status, JSON.stringify(body)).toBe(200);
			expect(r.body).toEqual({
				v: 1, found: false, matches: 0, status: 'not_found', anyFinanced: false, financing: 'none',
				claimsAffirmed: 'none', anySettled: false, anyStale: false, staleSince: null, debtor: 'none', withdrawn: false,
				refChecked: false, refMatch: false, firstSeen: null, test: body.test, checkedAt: expect.any(String),
			});
		}
	});

	it('an account that is not verified learns whether anything was found, and nothing more', async () => {
		const { secrets } = await financedPair();
		mem.verified = false;
		const hit = await check(withInvoice({ buyerRef: 'po 123' }));
		expect(hit.status).toBe(200);
		expect(Object.keys(hit.body)).toEqual([...FOUND_ONLY_KEYS]);
		expect(hit.body).toEqual({ v: 1, found: true, test: true, checkedAt: expect.any(String) });
		expectNoLeak(hit.body, secrets);
		const miss = await check(withInvoice({ invoiceNo: 'INV-0043' }, true));
		expect(miss.body).toEqual({ v: 1, found: false, test: true, checkedAt: expect.any(String) });
		expectPublicHeaders(hit.res);
	});

	it('the answer is the same whoever asks, the records\' own accounts included; a tenant in the body is ignored', async () => {
		await financedPair();
		const answers: unknown[] = [];
		for (const who of [ASKER, OWNER, RIVAL, LENDER]) {
			as(who);
			ip = `198.51.100.${++ipSeq % 250}`;
			const r = await check({ ...CHECK, tenantId: RIVAL, tenant_id: OWNER });
			expect(r.status).toBe(200);
			const { checkedAt, ...rest } = r.body;
			answers.push(rest);
		}
		expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
		expect(answers[0]).toMatchObject({ found: true, matches: 2 });
	});

	it('reads only: no write and no data batch', async () => {
		await financedPair();
		const writes = () => fake.statements(/^(INSERT|UPDATE|DELETE) /).length;
		const before = { writes: writes(), batches: fake.dataBatches().length };
		await check();
		mem.verified = false;
		await check();
		await check(withInvoice({ invoiceNo: 'INV-0043' }));
		await check({});
		expect(fake.statements(STORE_SQL)).toHaveLength(3);
		expect({ writes: writes(), batches: fake.dataBatches().length }).toEqual(before);
	});
});

describe('the request', () => {
	it('400 invalid with the parse message for every malformed body; the store is never read', async () => {
		const cases: Array<[string | unknown, string]> = [
			['not json', copy.SEEN_BEFORE_INVALID_BODY],
			[{}, copy.SEEN_BEFORE_INVALID_BODY],
			[[CHECK], copy.SEEN_BEFORE_INVALID_BODY],
			[{ invoice: 'INV-0042' }, copy.SEEN_BEFORE_INVALID_BODY],
			[{ ...CHECK.invoice }, copy.SEEN_BEFORE_INVALID_BODY],
			[withInvoice({ supplier: '' }), copy.SEEN_BEFORE_INVALID_PARTIES],
			[withInvoice({ buyer: '   ' }), copy.SEEN_BEFORE_INVALID_PARTIES],
			[withInvoice({ invoiceNo: undefined }), copy.SEEN_BEFORE_INVALID_PARTIES],
			[withInvoice({ invoiceNo: 42 }), copy.SEEN_BEFORE_INVALID_PARTIES],
			[withInvoice({ currency: '' }), copy.SEEN_BEFORE_INVALID_CURRENCY],
			[withInvoice({ face: '1000' }), copy.SEEN_BEFORE_INVALID_FACE],
			[withInvoice({ face: 0 }), copy.SEEN_BEFORE_INVALID_FACE],
			[withInvoice({ face: -5 }), copy.SEEN_BEFORE_INVALID_FACE],
			[withInvoice({ face: null }), copy.SEEN_BEFORE_INVALID_FACE],
			[withInvoice({ buyerRef: 123 }), copy.SEEN_BEFORE_INVALID_BUYER_REF],
			[withInvoice({ supplier: '...' }), copy.SEEN_BEFORE_INVALID_NAMES],
		];
		for (const [body, message] of cases) {
			const r = typeof body === 'string' ? await call('check', 'POST', { raw: body }) : await check(body);
			expect(r.status, JSON.stringify(body)).toBe(400);
			expect(r.body).toEqual({ ok: false, error: 'invalid', message });
			expectPublicHeaders(r.res);
		}
		expect(fake.statements(STORE_SQL)).toEqual([]);
		expect(mem.kicks).toBe(0);
	});

	it('413 above 4 KB, by the declared length, by the bytes sent, or streamed; exactly 4096 bytes is read', async () => {
		await create(RIVAL, INVOICE);
		const declared = await call('check', 'POST', { raw: JSON.stringify(CHECK), headers: { 'content-length': '4097' } });
		expect(declared.status).toBe(413);
		expect(declared.body).toEqual({ ok: false, error: 'too_large' });
		const big = JSON.stringify(withInvoice({ supplier: 'x'.repeat(5000) }));
		expect((await call('check', 'POST', { raw: big })).status).toBe(413);

		const mod: any = await import('../../src/pages/api/verify/receivables/check.ts');
		const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
		const request = new Request(`${BASE}/check`, {
			method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: stream, duplex: 'half',
		} as RequestInit);
		expect(request.headers.get('content-length')).toBeNull();
		expect((await mod.POST({ request })).status).toBe(413);

		// At the cap exactly: read, and the padding is trimmed before the match.
		const base = JSON.stringify(CHECK);
		const atCap = JSON.stringify(withInvoice({ supplier: CHECK.invoice.supplier.padEnd(CHECK.invoice.supplier.length + 4096 - base.length, ' ') }));
		expect(new TextEncoder().encode(atCap).byteLength).toBe(4096);
		const read = await call('check', 'POST', { raw: atCap });
		expect(read.status).toBe(200);
		expect(read.body.found).toBe(true);
	});

	it('GET, PUT, DELETE and PATCH answer 405 use_post, Allow: POST', async () => {
		const mod: any = await import('../../src/pages/api/verify/receivables/check.ts');
		for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
			const res: Response = await mod[method]({ request: new Request(`${BASE}/check`, { method }) });
			expect(res.status, method).toBe(405);
			expect(res.headers.get('allow')).toBe('POST');
			expect(await res.json()).toEqual({ ok: false, error: 'use_post' });
			expectPublicHeaders(res);
		}
	});
});

describe('limits', () => {
	it('429 with Retry-After 60 past 60 a minute for one account; another account goes on', async () => {
		for (let i = 0; i < 60; i++) expect((await check({})).status).toBe(400);
		const over = await check();
		expect(over.status).toBe(429);
		expect(over.body).toEqual({ ok: false, error: 'rate_limited' });
		expect(over.res.headers.get('retry-after')).toBe('60');
		expectPublicHeaders(over.res);
		as(RIVAL);
		ip = '198.51.100.250';
		expect((await check()).status).toBe(200);
	});

	it('429 past 120 a minute from one address, across accounts', async () => {
		for (let i = 0; i < 120; i++) {
			as(`tenant-many-${i % 3}`);
			expect((await check({})).status).toBe(400);
		}
		as('tenant-fresh');
		const over = await check();
		expect(over.status).toBe(429);
		expect(over.res.headers.get('retry-after')).toBe('60');
	});

	it('a call the account budget refused does not spend the address budget', async () => {
		as('tenant-busy');
		for (let i = 0; i < 100; i++) await check({});
		as('tenant-next');
		for (let i = 0; i < 60; i++) expect((await check({})).status, `call ${i + 1}`).toBe(400);
		as('tenant-last');
		expect((await check({})).status).toBe(429);
	});

	it('its budgets are its own: a spent precheck budget leaves the check alone', async () => {
		for (let i = 0; i < 61; i++) await call('precheck', 'POST', { body: {} });
		expect((await call('precheck', 'POST', { body: {} })).status).toBe(429);
		expect((await check()).status).toBe(200);
	});

	it('401 and 403 come before the limiter; the backfill is kicked only on an admitted, parsed call', async () => {
		as(null);
		for (let i = 0; i < 3; i++) expect((await check()).status).toBe(401);
		as(ASKER, true);
		for (let i = 0; i < 3; i++) expect((await check()).status).toBe(403);
		as(ASKER);
		expect((await call('check', 'POST', { raw: JSON.stringify(CHECK), headers: { 'content-length': '5000' } })).status).toBe(413);
		expect((await check({})).status).toBe(400);
		expect(mem.kicks).toBe(0);
		expect((await check()).status).toBe(200);
		expect(mem.kicks).toBe(1);
		// Three calls spent so far: the demo calls under the same account spent nothing.
		for (let i = 0; i < 57; i++) expect((await check({})).status).toBe(400);
		expect((await check()).status).toBe(429);
		expect(mem.kicks).toBe(1);
	});
});

describe('when the check cannot run: 503 check_unavailable, never found: false', () => {
	const expect503 = (r: Awaited<ReturnType<typeof call>>) => {
		expect(r.status).toBe(503);
		expect(r.body).toEqual(UNAVAILABLE);
		expect(r.body).not.toHaveProperty('found');
		expect(r.res.headers.get('retry-after')).toBe('30');
		expectPublicHeaders(r.res);
	};

	it('the store throws: one fixed log line, never the body', async () => {
		await financedPair();
		const logs: unknown[][] = [];
		for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
			vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { logs.push([level, ...a]); });
		}
		fake.options.failDml = (sql) => STORE_SQL.test(sql);
		expect503(await check(withInvoice({ buyerRef: 'PO-00123' })));
		expect(logs).toEqual([['error', '[receivables-check] store unavailable']]);
		mem.verified = false;
		expect503(await check());
		expect(mem.kicks).toBe(2);
	});

	it('the database is down', async () => {
		await financedPair();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		holder.db = { execute: async () => { throw new Error('connection refused'); }, batch: async () => { throw new Error('x'); } };
		vi.resetModules();
		expect503(await check());
		mem.verified = false;
		expect503(await check());
	});

	it('no fingerprint key', async () => {
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
		await load();
		await create(RIVAL, INVOICE);
		expect503(await check());
		mem.verified = false;
		expect503(await check());
		expect(fake.statements(STORE_SQL)).toEqual([]);
		expect(mem.kicks).toBe(2);
	});

	it('a record still waiting for the backfill (coverage fails), for either tier', async () => {
		fake.seed('receivables', {
			id: 'ab'.repeat(32), tenant_id: RIVAL, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: 'INV-0042',
			face: 1000, currency: 'USD', is_test: true, manifest_json: '{}', digest: 'd'.repeat(64), created_at: '2026-09-01 10:00:00',
		});
		expect503(await check());
		mem.verified = false;
		expect503(await check());
		expect(fake.statements(STORE_SQL)).toEqual([]);
	});
});

describe('the route source', () => {
	const SRC = fs.readFileSync(fileURLToPath(new URL('../../src/pages/api/verify/receivables/check.ts', import.meta.url)), 'utf8');

	it('writes each tier\'s answer as one literal, in the documented key order', () => {
		const literals = [...SRC.matchAll(/publicJson\(\{ (v: 1, [^}]*)\}/g)]
			.map((m) => m[1].split(',').map((p) => p.trim().split(':')[0]).filter(Boolean));
		expect(literals).toEqual([[...FULL_ANSWER_KEYS], [...FOUND_ONLY_KEYS]]);
	});

	it('has no agent-key tier and no CORS', () => {
		expect(SRC).not.toMatch(/agentKeys|authenticateAgentKey|Access-Control-Allow|OPTIONS/);
	});
});
