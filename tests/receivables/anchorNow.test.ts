import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * anchorNow (src/lib/receivables/server/anchorNow.ts): stamp one record right after it was
 * written. Fail-soft (never throws; the signed record stands), rate-limited per tenant, bounded
 * by a timeout, tenant-scoped through the registry, and it never replaces a receipt a record
 * already carries.
 *
 * The OpenTimestamps client is stubbed: no calendar is ever called from a test.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

const ots = vi.hoisted(() => ({
	stamps: [] as string[],
	mode: 'ok' as 'ok' | 'throw' | 'hang',
}));
vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
	OpenTimestampsAnchor: class {
		readonly type = 'opentimestamps';
		async stamp(digest: string) {
			if (ots.mode === 'throw') throw new Error('calendar unreachable');
			if (ots.mode === 'hang') return new Promise(() => {});
			ots.stamps.push(digest);
			return { type: 'opentimestamps', digest, receipt: 'cGVuZGluZw==', anchoredAt: null };
		}
		async upgrade(r: unknown) { return r; }
	},
}));

let fake: ReceivablesDbFake;
type AnchorNowModule = typeof import('../../src/lib/receivables/server/anchorNow');
let mod: AnchorNowModule;

const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const RID = 'c0'.repeat(32);

beforeEach(async () => {
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	ots.stamps = [];
	ots.mode = 'ok';
	const reg = await import('../../src/lib/receivablesRegistry');
	await reg.ensureReceivablesTables();
	mod = await import('../../src/lib/receivables/server/anchorNow');
	fake.seed('receivables', {
		id: RID, tenant_id: OWNER, supplier: 'Acme', buyer: 'Bigco', invoice_no: 'INV-1', face: 1000, currency: 'USD',
		is_test: false, manifest_json: '{}', digest: 'AB'.repeat(32), anchor_json: null, created_at: '2026-09-01 10:00:00',
	});
});
afterEach(() => { vi.useRealTimers(); });

const fresh = () => mod.evidenceStampLimiter.reset();

describe('anchorNow', () => {
	it('stamps the lowercased digest and keeps the pending receipt on the record', async () => {
		fresh();
		const r = await mod.anchorNow(OWNER, 'receivable', RID, mod.evidenceStampLimiter);
		const receipt = { type: 'opentimestamps', digest: 'ab'.repeat(32), receipt: 'cGVuZGluZw==', anchoredAt: null };
		expect(r).toEqual({ anchored: true, anchor: receipt });
		expect(ots.stamps).toEqual(['ab'.repeat(32)]);
		expect(JSON.parse(fake.rows('receivables')[0].anchor_json)).toEqual(receipt);
	});

	it("another tenant's record: not anchored, nothing sent, nothing written", async () => {
		fresh();
		expect(await mod.anchorNow(LENDER, 'receivable', RID, mod.evidenceStampLimiter)).toEqual({ anchored: false });
		expect(ots.stamps).toEqual([]);
		expect(fake.rows('receivables')[0].anchor_json).toBeNull();
	});

	it('a calendar failure is reported, never thrown, and stores nothing', async () => {
		fresh();
		ots.mode = 'throw';
		expect(await mod.anchorNow(OWNER, 'receivable', RID, mod.evidenceStampLimiter))
			.toEqual({ anchored: false, anchorError: 'calendar unreachable' });
		expect(fake.rows('receivables')[0].anchor_json).toBeNull();
	});

	it('a hung calendar times out instead of holding the request', async () => {
		fresh();
		ots.mode = 'hang';
		const r = await mod.anchorNow(OWNER, 'receivable', RID, mod.evidenceStampLimiter, { timeoutMs: 20 });
		expect(r).toEqual({ anchored: false, anchorError: 'anchor_timeout' });
		expect(fake.rows('receivables')[0].anchor_json).toBeNull();
		expect(mod.STAMP_TIMEOUT_MS).toBe(15_000);
	});

	it('never replaces a receipt the record already carries', async () => {
		fresh();
		const confirmed = { type: 'opentimestamps', digest: 'ab'.repeat(32), receipt: 'ZG9uZQ==', anchoredAt: '2026-10-01T00:00:00.000Z' };
		fake.rows('receivables')[0].anchor_json = JSON.stringify(confirmed);
		expect(await mod.anchorNow(OWNER, 'receivable', RID, mod.evidenceStampLimiter)).toEqual({ anchored: true, anchor: confirmed });
		expect(ots.stamps).toEqual([]);
	});

	it('evidence stamps: 30 an hour per tenant, then rate_limited without calling the calendars; other tenants unaffected', async () => {
		fresh();
		for (let i = 0; i < 30; i++) {
			fake.rows('receivables')[0].anchor_json = null;
			expect((await mod.anchorNow(OWNER, 'receivable', RID, mod.evidenceStampLimiter)).anchored).toBe(true);
		}
		fake.rows('receivables')[0].anchor_json = null;
		expect(await mod.anchorNow(OWNER, 'receivable', RID, mod.evidenceStampLimiter)).toEqual({ anchored: false, anchorError: 'rate_limited' });
		expect(ots.stamps).toHaveLength(30);
		expect(mod.evidenceStampLimiter.hit(`tenant:${LENDER}`)).toBe(false);
	});

	it('cron stamps: 10 per tenant per run, and every run starts with a fresh budget', () => {
		expect(mod.CRON_STAMPS_PER_TENANT).toBe(10);
		const run1 = mod.newCronStampLimiter();
		for (let i = 0; i < 10; i++) expect(run1.hit('tenant:t')).toBe(false);
		expect(run1.hit('tenant:t')).toBe(true);
		expect(run1.hit('tenant:other')).toBe(false);
		// The next run, even one that starts minutes later, is not shut out by the last one.
		const run2 = mod.newCronStampLimiter();
		expect(run2.hit('tenant:t')).toBe(false);
	});
});

describe('the routes stamp only through anchorNow', () => {
	const read = (rel: string) => fs.readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
	for (const route of ['diligence-accept', 'discharge', 'settle']) {
		it(`${route}.ts calls anchorNow with the shared evidence limiter and has no stamping code of its own`, () => {
			const src = read(`src/pages/api/verify/receivables/${route}.ts`);
			expect(src).toMatch(/anchorNow\(session\.tenantId, '\w+', \w+(\.\w+)?, evidenceStampLimiter\)/);
			expect(src).not.toMatch(/OpenTimestampsAnchor|createFixedWindowLimiter|setRecordAnchor/);
		});
	}
});
