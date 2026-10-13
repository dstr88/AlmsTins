import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * The fingerprint backfill (S3): startFingerprintBackfill in the registry, and its triggers in
 * src/lib/receivables/server/fingerprintBackfill.ts. Fresh modules per test (vi.resetModules), so
 * the single-flight run, the throttle and the coverage count start cold. Keys are generated here.
 */

const holder = vi.hoisted(() => ({
	db: null as any,
	/** The request context each statement ran under (undefined: none, so the owner pool). */
	contexts: [] as unknown[],
	getCtx: null as null | (() => unknown),
	/** When set, a statement waits for this before it runs (only those matching gateOn, when set). */
	gate: null as null | Promise<void>,
	gateOn: null as null | RegExp,
}));
vi.mock('@/lib/db', () => ({
	db: {
		execute: async (s: any) => {
			holder.contexts.push(holder.getCtx?.());
			if (holder.gate && (!holder.gateOn || holder.gateOn.test(String(s?.sql ?? s)))) await holder.gate;
			return holder.db.execute(s);
		},
		batch: (s: any) => holder.db.batch(s),
	},
}));

vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
	OpenTimestampsAnchor: class {
		readonly type = 'opentimestamps';
		async stamp(): Promise<never> { throw new Error('calendar unreachable'); }
		async upgrade(): Promise<never> { throw new Error('calendar unreachable'); }
	},
}));

type Registry = typeof import('../../src/lib/receivablesRegistry');
type Triggers = typeof import('../../src/lib/receivables/server/fingerprintBackfill');
let fake: ReceivablesDbFake;
let reg: Registry;
let triggers: Triggers;
let dbContext: typeof import('../../src/lib/dbContext');

async function load(options: Parameters<typeof createReceivablesDbFake>[0] = {}) {
	vi.resetModules();
	fake = createReceivablesDbFake(options);
	holder.db = fake;
	holder.contexts = [];
	holder.gate = null;
	holder.gateOn = null;
	dbContext = await import('../../src/lib/dbContext');
	holder.getCtx = () => dbContext.getDbContext();
	reg = await import('../../src/lib/receivablesRegistry');
	triggers = await import('../../src/lib/receivables/server/fingerprintBackfill');
}

const id = (i: number) => i.toString(16).padStart(64, '0');
function seedRows(n: number, over: (i: number) => Record<string, unknown> = () => ({})) {
	for (let i = 1; i <= n; i++) {
		fake.seed('receivables', {
			id: id(i), tenant_id: i % 2 ? 'tenant-a' : 'tenant-b', supplier: `Supplier ${i % 7}`, buyer: 'Bigco Plc',
			invoice_no: `INV-${i}`, face: 100 * i, currency: 'USD', details_json: i % 3 ? null : JSON.stringify({ buyerRef: `PO-${i}` }),
			is_test: i % 5 === 0, manifest_json: '{}', digest: 'd'.repeat(64), created_at: '2026-09-01 10:00:00',
			updated_at: '2026-09-02 10:00:00', ...over(i),
		});
	}
}

const backfillSelects = () => fake.statements(/^SELECT id, supplier, buyer, invoice_no, face, currency, details_json, is_test FROM receivables WHERE/);
const backfillUpdates = () => fake.statements(/^UPDATE receivables SET fingerprint_ref = \?, fingerprint_inv = \?, fingerprint_kid = \? WHERE id = \?/);

let logs: { level: string; args: unknown[] }[];
beforeEach(async () => {
	logs = [];
	for (const level of ['log', 'warn', 'error'] as const) {
		vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push({ level, args }); });
	}
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', randomBytes(32).toString('hex'));
	vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
	await load();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('startFingerprintBackfill', () => {
	it('fills every row in keyset batches of 200, without touching updated_at', async () => {
		seedRows(450);
		const r = await reg.startFingerprintBackfill();
		expect(r).toMatchObject({ state: 'complete', updated: 450, skipped: 0 });
		expect(backfillSelects()).toHaveLength(3);
		expect(backfillSelects().map((s) => s.args[1])).toEqual(['', id(200), id(400)]);
		expect(backfillUpdates()).toHaveLength(450);
		const kid = backfillUpdates()[0].args[2];
		for (const row of fake.rows('receivables')) {
			expect(row.fingerprint_kid).toBe(kid);
			expect(row.fingerprint_inv).toMatch(/^[0-9a-f]{64}$/);
			expect(row.updated_at).toBe('2026-09-02 10:00:00');
		}
		expect(fake.rows('receivables').filter((x) => x.fingerprint_ref).length).toBe(150);
		expect(fake.dataBatches()).toEqual([]);
		expect(await reg.fingerprintCoverageOk()).toBe(true);
	});

	it('includes withdrawn rows', async () => {
		seedRows(3, (i) => ({ deleted_at: i === 2 ? '2026-10-01 00:00:00' : null }));
		await reg.startFingerprintBackfill();
		expect(fake.rows('receivables').every((x) => x.fingerprint_kid)).toBe(true);
	});

	it('skips a row that fails, moves past it, and reports partial; the next run heals it', async () => {
		let failing = true;
		await load({ failDml: (sql, args) => failing && /^UPDATE receivables SET fingerprint_ref/.test(sql) && args[3] === id(7) });
		seedRows(250);
		const r = await reg.startFingerprintBackfill();
		expect(r).toMatchObject({ state: 'partial', updated: 249, skipped: 1 });
		expect(backfillSelects()).toHaveLength(2);
		expect(await reg.fingerprintCoverageOk()).toBe(false);
		const warn = logs.find((l) => l.level === 'warn')!;
		expect(warn.args).toEqual(['[receivables] fingerprint backfill skipped rows:', { updated: 249, skipped: 1, ms: expect.any(Number) }]);

		failing = false;
		expect(await reg.startFingerprintBackfill()).toMatchObject({ state: 'complete', updated: 1, skipped: 0 });
		expect(await reg.fingerprintCoverageOk()).toBe(true);
	});

	it('a second run updates nothing', async () => {
		seedRows(5);
		await reg.startFingerprintBackfill();
		const n = backfillUpdates().length;
		expect(await reg.startFingerprintBackfill()).toMatchObject({ state: 'complete', updated: 0, skipped: 0 });
		expect(backfillUpdates()).toHaveLength(n);
	});

	it('is single-flight: concurrent callers share one run', async () => {
		seedRows(5);
		const [a, b] = await Promise.all([reg.startFingerprintBackfill(), reg.startFingerprintBackfill()]);
		expect(a).toBe(b);
		expect(backfillSelects()).toHaveLength(1);
	});

	it('a key rotation makes every row stale, and the next run heals them', async () => {
		seedRows(4);
		await reg.startFingerprintBackfill();
		expect(await reg.fingerprintCoverageOk()).toBe(true);
		const before = fake.rows('receivables').map((x) => x.fingerprint_inv);
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', randomBytes(32).toString('base64'));
		expect(await reg.fingerprintCoverageOk()).toBe(false);
		expect(await reg.startFingerprintBackfill()).toMatchObject({ state: 'complete', updated: 4 });
		expect(await reg.fingerprintCoverageOk()).toBe(true);
		const after = fake.rows('receivables').map((x) => x.fingerprint_inv);
		after.forEach((v, i) => expect(v).not.toBe(before[i]));
	});

	it('without a key: off, before any SQL', async () => {
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
		await load();
		expect(await reg.startFingerprintBackfill()).toEqual({ state: 'off', updated: 0, skipped: 0, ms: 0 });
		expect(fake.log).toEqual([]);
	});

	it('is never started by importing the registry or the trigger module', async () => {
		seedRows(3);
		await new Promise((r) => setTimeout(r, 5));
		expect(fake.log).toEqual([]);
	});

	it('logs counts only: never a key, a kid, an ID or a field', async () => {
		seedRows(3);
		await reg.startFingerprintBackfill();
		expect(logs).toEqual([{ level: 'log', args: ['[receivables] fingerprint backfill complete', { updated: 3, skipped: 0, ms: expect.any(Number) }] }]);
		await reg.startFingerprintBackfill();
		expect(logs).toHaveLength(1);
		const text = JSON.stringify(logs);
		const kid = fake.rows('receivables')[0].fingerprint_kid;
		for (const secret of [process.env.RECEIVABLES_FINGERPRINT_KEY!, kid, id(1), 'Bigco', 'INV-1']) expect(text).not.toContain(secret);
	});

	it('runs outside the request\'s tenant context, on the owner pool', async () => {
		seedRows(3);
		await dbContext.runWithDbContext({ tenantId: 'tenant-a', userId: 'user-a' }, async () => {
			await reg.ensureReceivablesTables();
			const inside = holder.contexts.length;
			await reg.startFingerprintBackfill();
			expect(holder.contexts.slice(inside).length).toBeGreaterThan(0);
			expect(holder.contexts.slice(inside).every((c) => c === undefined)).toBe(true);
		});
		expect(holder.contexts.slice(0, 1)).toEqual([{ tenantId: 'tenant-a', userId: 'user-a' }]);
	});
});

describe('kickFingerprintBackfill', () => {
	it('starts at once, then at most once per five minutes, and never without a key', async () => {
		seedRows(2);
		const t0 = 1_000_000;
		triggers.kickFingerprintBackfill(t0);
		await vi.waitFor(() => expect(backfillSelects()).toHaveLength(1));
		await new Promise((r) => setTimeout(r, 5));
		triggers.kickFingerprintBackfill(t0 + 60_000);
		await new Promise((r) => setTimeout(r, 5));
		expect(backfillSelects()).toHaveLength(1);
		triggers.kickFingerprintBackfill(t0 + triggers.THROTTLE_MS);
		await vi.waitFor(() => expect(backfillSelects()).toHaveLength(2));

		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
		await load();
		triggers.kickFingerprintBackfill();
		await new Promise((r) => setTimeout(r, 5));
		expect(fake.log).toEqual([]);
	});
});

describe('backfillWithin (the cron)', () => {
	it('reports complete with counts, off without a key, and running past the wait', async () => {
		seedRows(3);
		expect(await triggers.backfillWithin(60_000)).toEqual({ fingerprints: 'complete', updated: 3, skipped: 0 });

		await load();
		seedRows(3);
		let release!: () => void;
		holder.gate = new Promise<void>((r) => { release = r; });
		expect(await triggers.backfillWithin(10)).toEqual({ fingerprints: 'running' });
		expect(reg.fingerprintBackfillRunning()).toBe(true);
		release();
		holder.gate = null;
		await vi.waitFor(() => expect(reg.fingerprintBackfillRunning()).toBe(false));
		expect(fake.rows('receivables').every((x) => x.fingerprint_kid)).toBe(true);

		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
		await load();
		expect(await triggers.backfillWithin(60_000)).toEqual({ fingerprints: 'off' });
		expect(fake.log).toEqual([]);
	});
});

describe('GET /api/cron/upgrade-anchors reports the backfill', () => {
	async function cron() {
		vi.stubEnv('CRON_SECRET', 'test-cron-secret');
		const { GET } = await import('../../src/pages/api/cron/upgrade-anchors');
		const res: Response = await (GET as any)({
			request: new Request('https://almstins.com/api/cron/upgrade-anchors', { headers: { 'x-cron-secret': 'test-cron-secret' } }),
		});
		return { status: res.status, body: await res.json() };
	}

	it('complete with counts once every row is fingerprinted, then nothing left to do', async () => {
		seedRows(4);
		const first = await cron();
		expect(first.status).toBe(200);
		expect(first.body).toMatchObject({ ok: true, fingerprints: 'complete', updated: 4, skipped: 0 });
		expect((await cron()).body).toMatchObject({ fingerprints: 'complete', updated: 0, skipped: 0 });
		expect(JSON.stringify(first.body)).not.toMatch(/fp1-|[0-9a-f]{64}/);
	});

	it('near the end of its time, the run does not wait: the backfill keeps going in the background', async () => {
		seedRows(2);
		await reg.ensureReceivablesTables();
		let release!: () => void;
		holder.gate = new Promise<void>((r) => { release = r; });
		holder.gateOn = /^\s*SELECT id, supplier, buyer, invoice_no/;
		const t0 = Date.now();
		let calls = 0;
		// The first reading is the run's start; every later one is 600 s on, past its budget.
		vi.spyOn(Date, 'now').mockImplementation(() => (calls++ === 0 ? t0 : t0 + 600_000));
		const { body } = await cron();
		expect(body).toMatchObject({ ok: true, fingerprints: 'running' });
		release();
		holder.gate = null;
		await vi.waitFor(() => expect(reg.fingerprintBackfillRunning()).toBe(false));
		expect(fake.rows('receivables').every((x) => x.fingerprint_kid)).toBe(true);
	});

	it('off without a key, and the rest of the run is unchanged', async () => {
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
		await load();
		seedRows(2);
		const { status, body } = await cron();
		expect(status).toBe(200);
		expect(body).toMatchObject({ ok: true, checked: 0, stamped: 0, fingerprints: 'off' });
		expect(body).not.toHaveProperty('updated');
		expect(fake.rows('receivables').every((x) => !x.fingerprint_kid)).toBe(true);
	});
});
