import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createReceivablesDbFake, normalizeSql, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { wholeMonthsSince } from '../../src/lib/receivables/aging';
import { freshnessLineHtml } from '../../src/components/receivables/AgingPill/freshnessLine';
import { seenBeforeView } from '../../src/lib/receivables/seenBeforeView';
import { summarizeMatches, type SeenBeforeAnswer, type SeenBeforeInput } from '../../src/lib/receivables/seenBefore';
import {
	FRESHNESS_DETAIL_GRACE,
	FRESHNESS_DETAIL_LAPSED,
	FRESHNESS_DETAIL_NO_DATE,
	FRESHNESS_DETAIL_PASS,
	LAPSED_PUBLIC_LINE,
} from '../../src/lib/receivables/copy/aging';
import { SEEN_BEFORE_STALE_PREFIX } from '../../src/lib/receivables/copy/seenBefore';

/**
 * Relying-party surfaces (aging A3): the freshness story on the public lookup and the
 * "Seen before?" answer, the lapse filter on the raw ENCUMBRANCE_SQL paths (the duplicate
 * check's twins and the seen-before store), and Verify now's freshness check. The registry's
 * real SQL runs against the db fake; every `now` the code takes is an explicit parameter.
 * All names, amounts and dates are invented.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

type Registry = typeof import('../../src/lib/receivablesRegistry');
type Store = typeof import('../../src/lib/receivables/server/seenBeforeStore');
let fake: ReceivablesDbFake;
let reg: Registry;
let store: Store;

const OWNER = 'tenant-owner';
const RIVAL = 'tenant-rival-supplier';
const FIRST = 'tenant-first-lender';
const CHECKER = 'tenant-checker';
const SEED = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';

const INVOICE = { supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'INV-0042', face: 1000, currency: 'USD', isTest: true };
const CHECK: SeenBeforeInput = { ...INVOICE, buyerRef: null };

/** The claim is registered (and affirmed) in early October 2026. */
const TOUCH_DAY = '2026-10-02';
/** Due 2026-10-20: active on 2026-10-15, in grace on 2026-10-25, past due on 2026-11-05
 *  (16 days past, touch 34 days old — stale but far from lapse), lapsed by 2027-06-01. */
const NOW_ACTIVE = new Date('2026-10-15T00:00:00Z');
const NOW_GRACE = new Date('2026-10-25T00:00:00Z');
const NOW_PAST_DUE = new Date('2026-11-05T12:00:00Z');
const NOW_LAPSED = new Date('2027-06-01T00:00:00Z');

async function load(options: Parameters<typeof createReceivablesDbFake>[0] = {}) {
	vi.resetModules();
	fake = createReceivablesDbFake(options);
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
	store = await import('../../src/lib/receivables/server/seenBeforeStore');
}

type Created = Extract<Awaited<ReturnType<Registry['createReceivable']>>, { ok: true }>;
async function create(tenant: string, input: Record<string, unknown>): Promise<Created> {
	const r = await reg.createReceivable(tenant, input as any);
	if (!r.ok) throw new Error(`create failed: ${JSON.stringify(r)}`);
	return r;
}
const rowOf = (id: string) => fake.rows('receivables').find((x) => x.id === id)!;

let claimSeq = 0;
function seedClaim(receivableId: string, over: Record<string, unknown> = {}) {
	return fake.seed('receivable_claims', {
		id: `claim-${++claimSeq}`, receivable_id: receivableId, tenant_id: FIRST, financier: 'First Lender',
		amount: 400, currency: 'USD', claim_date: TOUCH_DAY, status: 'active', manifest_json: '{}', signature_json: null,
		digest: 'e'.repeat(64), anchor_json: null, discharged_at: null, affirmed_at: null, affirmed_by: null,
		created_at: `${TOUCH_DAY} 10:00:00`, ...over,
	});
}

beforeEach(async () => {
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', randomBytes(32).toString('hex'));
	vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	await load();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

// ── wholeMonthsSince (pure) ─────────────────────────────────────────────────

describe('wholeMonthsSince', () => {
	const NOW = new Date('2026-11-05T12:00:00Z');

	it('whole UTC calendar months, day-of-month aware', () => {
		expect(wholeMonthsSince('2026-10-02 10:00:00', NOW)).toBe(1);
		expect(wholeMonthsSince('2026-10-06 10:00:00', NOW)).toBe(0);
		expect(wholeMonthsSince('2026-10-05 23:59:59', NOW)).toBe(1);
		expect(wholeMonthsSince('2026-07-02 10:00:00', NOW)).toBe(4);
		expect(wholeMonthsSince('2025-11-05 00:00:00', NOW)).toBe(12);
		expect(wholeMonthsSince('2026-11-05', NOW)).toBe(0);
	});

	it('never negative, and null on missing or unparseable input', () => {
		expect(wholeMonthsSince('2027-01-01 00:00:00', NOW)).toBe(0);
		expect(wholeMonthsSince(null, NOW)).toBeNull();
		expect(wholeMonthsSince(undefined, NOW)).toBeNull();
		expect(wholeMonthsSince('not a date', NOW)).toBeNull();
		expect(wholeMonthsSince('', NOW)).toBeNull();
	});
});

// ── freshnessLineHtml (the public lookup's story line) ──────────────────────

describe('freshnessLineHtml', () => {
	const NOW = new Date('2026-11-05T12:00:00Z');
	const at = (aging: string, lastOwnerTouchAt: string | null) => freshnessLineHtml({ aging, lastOwnerTouchAt }, NOW);

	it('a past-due claim a month or more stale reads as the actor-voiced duration', () => {
		expect(at('past_due_not_updated', '2026-10-02 10:00:00'))
			.toBe('<div class="rcv-freshline rcv-freshline--past_due_not_updated">This claim has not been updated by its lender in 1 month.</div>');
		expect(at('past_due_not_updated', '2026-07-02 10:00:00')).toContain('in 4 months.');
	});

	it('under a month, the dated wording', () => {
		expect(at('past_due_not_updated', '2026-10-28 09:00:00'))
			.toContain('past its promised date and has not been updated by its lender since 2026-10-28.');
	});

	it('a lapsed claim reads the lapse line: record not maintained, no longer counted, revival named', () => {
		const html = at('lapsed', '2026-01-01 10:00:00');
		expect(html).toContain('rcv-freshline--lapsed');
		expect(html).toContain('lapsed — record not maintained');
		expect(html).toContain(LAPSED_PUBLIC_LINE);
		expect(html).not.toMatch(/abandon/i);
	});

	it('every other state, and anything malformed, renders nothing', () => {
		for (const aging of ['active', 'due_in_grace', 'no_promised_date', 'settled', 'ag-lapsed" onmouseover="x', '', undefined]) {
			expect(freshnessLineHtml({ aging, lastOwnerTouchAt: '2026-10-02 10:00:00' }, NOW)).toBe('');
		}
		expect(freshnessLineHtml(null, NOW)).toBe('');
		expect(freshnessLineHtml('past_due_not_updated', NOW)).toBe('');
		// A past-due claim with no readable touch shows no line rather than inventing one.
		expect(at('past_due_not_updated', null)).toBe('');
		expect(at('past_due_not_updated', 'garbage')).toBe('');
	});

	it('raw input never reaches the markup', () => {
		// A hostile tail after a date part is cut by the 10-character day slice, and the line
		// is escaped besides; the class comes from the fixed pair, never from the claim.
		const html = freshnessLineHtml({ aging: 'past_due_not_updated', lastOwnerTouchAt: '2026-10-28<img src=x onerror=1>' }, NOW);
		expect(html).toContain('since 2026-10-28.');
		expect(html).not.toMatch(/img|onerror/);
		// The only tags are the wrapper's own.
		expect(html.match(/</g)).toHaveLength(2);
		expect(at('lapsed', null)).toContain('rcv-freshline--lapsed');
	});
});

// ── The seen-before view's story line ───────────────────────────────────────

describe('seenBeforeView: the freshness story (A3)', () => {
	const answer = (over: Partial<SeenBeforeAnswer>): SeenBeforeAnswer => ({
		v: 1, found: true, matches: 1, status: 'financed', anyFinanced: true, financing: 'partial',
		claimsAffirmed: 'none', anySettled: false, anyStale: false, staleSince: null, debtor: 'none',
		withdrawn: false, refChecked: false, refMatch: false, firstSeen: '2026-09-01', test: true,
		checkedAt: '2026-11-05T12:00:00.000Z', ...over,
	});

	it('a stale match carries the dated story line', () => {
		const view = seenBeforeView({ kind: 'full', answer: answer({ anyStale: true, staleSince: '2026-10-02' }) });
		expect(view.lines).toContain(SEEN_BEFORE_STALE_PREFIX + '2026-10-02.');
	});

	it('a current match carries no story line, and the found-only tier never sees one', () => {
		const view = seenBeforeView({ kind: 'full', answer: answer({}) });
		expect(view.lines.join(' ')).not.toContain('not updated by its lender');
		const foundOnly = seenBeforeView({ kind: 'found_only', found: true });
		expect(foundOnly.lines.join(' ')).not.toContain('not updated');
	});
});

// ── The lapse filter on the duplicate check's twins ─────────────────────────

describe('duplicate check twins: lapsed financing reads as not financed (A3)', () => {
	const probe = (viewer: string) => reg.previewDuplicateCheck({
		supplier: INVOICE.supplier, buyer: INVOICE.buyer, invoiceNo: 'INV 42', face: INVOICE.face,
		currency: INVOICE.currency, isTest: true,
	}, viewer);

	it('a maintained claim still reads financed; once it lapses, the match stays and the financed flag drops', async () => {
		const a = await create(OWNER, { ...INVOICE, dueDate: '2026-10-20' });
		seedClaim(a.id);
		// The pinned suite clock (2026-11-05) sits 34 days after the touch: maintained.
		expect(await probe(RIVAL)).toMatchObject({ ok: true, duplicateCheck: { state: 'possible_duplicate', encumbered: true } });
		// 2027-06-01 is 242 days after the touch: lapsed. The record still matches — nothing is
		// erased — but a financing nobody maintained no longer shadows the client. The precheck
		// takes no `now`, so the clock itself moves (Date only, restored right after).
		vi.useFakeTimers({ now: NOW_LAPSED, toFake: ['Date'] });
		try {
			expect(await probe(RIVAL)).toMatchObject({ ok: true, duplicateCheck: { state: 'possible_duplicate', encumbered: false } });
		} finally {
			vi.useRealTimers();
		}
	});

	it('Verify now tells a verified checker the match is not recorded as financed once it lapsed; one update revives it', async () => {
		const a = await create(OWNER, { ...INVOICE, dueDate: '2026-10-20' });
		const claim = seedClaim(a.id);
		const b = await create(RIVAL, { ...INVOICE, invoiceNo: 'INV 42' });
		const dupRow = async (now: Date) => {
			const r = await reg.reverifyReceivable(CHECKER, b.id, { persist: false, verifiedViewer: true, now });
			if (!r.ok) throw new Error('not found');
			return r.checks.find((c) => c.key === 'duplicate')!;
		};
		expect((await dupRow(NOW_PAST_DUE)).detail).toMatch(/is recorded as financed/);
		expect((await dupRow(NOW_LAPSED)).detail).toMatch(/It is not recorded as financed/);
		// The first lender wakes up and extends: the claim counts again.
		const revived = await reg.addExtension(FIRST, String(claim.id), { newPromisedDate: '2027-07-01', reasonCode: 'renegotiated_terms' }, NOW_LAPSED);
		expect(revived).toMatchObject({ ok: true });
		expect((await dupRow(new Date('2027-06-01T01:00:00Z'))).detail).toMatch(/is recorded as financed/);
	});
});

// ── The lapse filter and freshness story in the seen-before store ───────────

describe('seen-before: lapsed claims are left out of the answer; stale ones tell the story (A3)', () => {
	it('past due (not lapsed): still financed, with the story fields set to the stalest claim', async () => {
		const a = await create(OWNER, { ...INVOICE, dueDate: '2026-10-20' });
		seedClaim(a.id, { affirmed_at: '2026-10-02 11:00:00' });
		const read = await store.readSeenBefore(CHECK, NOW_PAST_DUE);
		if (read.state !== 'ok') throw new Error('unavailable');
		expect(read.rows[0]).toMatchObject({
			encumbered: true, claimed: 400, anyAffirmed: true, anyUnaffirmed: false,
			anyStale: true, staleSince: TOUCH_DAY,
		});
		const answer = summarizeMatches(read.rows, { refChecked: false, test: true, checkedAt: '2026-11-05T12:00:00.000Z' });
		expect(answer).toMatchObject({ status: 'financed', anyFinanced: true, anyStale: true, staleSince: TOUCH_DAY });
		// Nothing in the rows or the answer names the record, the account or a reason.
		expect(JSON.stringify([read.rows, answer])).not.toMatch(new RegExp(`${a.id}|${OWNER}|${FIRST}`));
	});

	it('lapsed: the record still matches, but the financing is no longer counted and tells no story', async () => {
		const a = await create(OWNER, { ...INVOICE, dueDate: '2026-10-20' });
		seedClaim(a.id);
		const read = await store.readSeenBefore(CHECK, NOW_LAPSED);
		if (read.state !== 'ok') throw new Error('unavailable');
		expect(read.rows).toHaveLength(1);
		expect(read.rows[0]).toMatchObject({ encumbered: false, claimed: 0, anyAffirmed: false, anyUnaffirmed: false, anyStale: false, staleSince: null });
		const answer = summarizeMatches(read.rows, { refChecked: false, test: true, checkedAt: '2027-06-01T00:00:00.000Z' });
		expect(answer).toMatchObject({ found: true, status: 'recorded', anyFinanced: false, financing: 'none', anyStale: false, staleSince: null });
	});

	it('one dated update revives it: counted again, story and all', async () => {
		const a = await create(OWNER, { ...INVOICE, dueDate: '2026-10-20' });
		const claim = seedClaim(a.id);
		await reg.markUnpaid(FIRST, String(claim.id), { note: 'chasing the debtor' }, NOW_LAPSED);
		// The unpaid flag is a touch but moves no date, so the record honestly reads past due.
		const read = await store.readSeenBefore(CHECK, new Date('2027-06-01T01:00:00Z'));
		if (read.state !== 'ok') throw new Error('unavailable');
		expect(read.rows[0]).toMatchObject({ encumbered: true, claimed: 400, anyStale: true, staleSince: '2027-06-01' });
	});

	it('active and in-grace financing reads exactly as before, with no story', async () => {
		const a = await create(OWNER, { ...INVOICE, dueDate: '2026-10-20' });
		seedClaim(a.id);
		for (const now of [NOW_ACTIVE, NOW_GRACE]) {
			const read = await store.readSeenBefore(CHECK, now);
			if (read.state !== 'ok') throw new Error('unavailable');
			expect(read.rows[0]).toMatchObject({ encumbered: true, claimed: 400, anyStale: false, staleSince: null });
		}
	});

	it('a settled record keeps its claims counted as before (a closed deal is not re-aged)', async () => {
		const a = await create(OWNER, { ...INVOICE, dueDate: '2026-10-20' });
		seedClaim(a.id);
		rowOf(a.id).settled_at = '2026-10-25';
		const read = await store.readSeenBefore(CHECK, NOW_LAPSED);
		if (read.state !== 'ok') throw new Error('unavailable');
		expect(read.rows[0]).toMatchObject({ settled: true, encumbered: true, claimed: 400, anyStale: false });
	});

	it('the lapse recompute runs outside the request tenant context, like the store SELECT', async () => {
		const dbContext = await import('../../src/lib/dbContext');
		const a = await create(OWNER, { ...INVOICE, dueDate: '2026-10-20' });
		seedClaim(a.id);
		const contexts: Array<{ sql: string; ctx: unknown }> = [];
		const inner = fake;
		holder.db = {
			execute: (st: any) => { contexts.push({ sql: normalizeSql(String(st?.sql ?? st)), ctx: dbContext.getDbContext() }); return inner.execute(st); },
			batch: (st: any) => inner.batch(st),
		};
		const read = await dbContext.runWithDbContext({ tenantId: CHECKER, userId: 'user-checker' }, () => store.readSeenBefore(CHECK, NOW_PAST_DUE));
		expect(read).toMatchObject({ state: 'ok' });
		const agingReads = contexts.filter((c) => /FROM (receivable_claims|receivable_status_events|receivable_reverifications)\b/.test(c.sql));
		expect(agingReads.length).toBeGreaterThan(0);
		for (const c of agingReads) expect(c.ctx, c.sql).toBeUndefined();
	});

	it('extension reasons never reach the rows or the answer (D3)', async () => {
		const a = await create(OWNER, { ...INVOICE, dueDate: '2026-10-20' });
		const claim = seedClaim(a.id);
		await reg.addExtension(FIRST, String(claim.id), { newPromisedDate: '2026-10-21', reasonCode: 'debtor_requested', reasonNote: 'zz-invented-reason-note' }, NOW_PAST_DUE);
		const read = await store.readSeenBefore(CHECK, new Date('2026-11-06T00:00:00Z'));
		if (read.state !== 'ok') throw new Error('unavailable');
		const answer = summarizeMatches(read.rows, { refChecked: false, test: true, checkedAt: '2026-11-06T00:00:00.000Z' });
		const text = JSON.stringify([read.rows, answer]);
		expect(text).not.toContain('zz-invented-reason-note');
		expect(text).not.toMatch(/reason/i);
	});
});

// ── Verify now: the freshness check ─────────────────────────────────────────

describe('Verify now: the freshness check (A3)', () => {
	/** A record every other check passes on: signed at create (integrity), anchored, buyer
	 *  attested, a debtor reference recorded with no twin (duplicate pass), one affirmed claim
	 *  within headroom. Only the clock moves between verdicts. */
	async function dressedRecord(over: Record<string, unknown> = {}) {
		const a = await create(OWNER, { ...INVOICE, dueDate: '2026-10-20', details: { buyerRef: 'PO-00123' }, ...over });
		rowOf(a.id).anchor_json = JSON.stringify({ anchoredAt: '2026-10-03 12:00:00' });
		fake.seed('receivable_attestations', {
			id: 'att-buyer', receivable_id: a.id, tenant_id: OWNER, role: 'buyer', label: 'Bigco Plc',
			statement: 'Confirms invoice INV-0042.', attested_at: '2026-10-03', manifest_json: '{}',
			signature_json: null, digest: 'f'.repeat(64), anchor_json: null, created_at: '2026-10-03 10:00:00', source: 'debtor_confirmation',
		});
		seedClaim(a.id, { affirmed_at: '2026-10-02 11:00:00' });
		return a;
	}
	const verify = (id: string, now: Date) => reg.reverifyReceivable(CHECKER, id, { persist: false, now });
	const freshnessOf = async (id: string, now: Date) => {
		const r = await verify(id, now);
		if (!r.ok) throw new Error('not found');
		return { verdict: r.verdict, row: r.checks.find((c) => c.key === 'freshness'), keys: r.checks.map((c) => c.key) };
	};

	it('on time: the check is named, passes, and the dressed record reads confirmed', async () => {
		const a = await dressedRecord();
		const { verdict, row, keys } = await freshnessOf(a.id, NOW_ACTIVE);
		expect(keys).toEqual(['integrity', 'headroom', 'duplicate', 'acknowledged', 'affirmation', 'anchor', 'freshness']);
		expect(row).toMatchObject({ key: 'freshness', label: 'Record freshness', state: 'pass', detail: FRESHNESS_DETAIL_PASS });
		expect(verdict).toBe('confirmed');
	});

	it('in grace: still a pass (a normal slip), still confirmed', async () => {
		const a = await dressedRecord();
		const { verdict, row } = await freshnessOf(a.id, NOW_GRACE);
		expect(row).toMatchObject({ state: 'pass', detail: FRESHNESS_DETAIL_GRACE });
		expect(verdict).toBe('confirmed');
	});

	it('past due, not updated: warn with the stalest date named, and the verdict is attention, never silently confirmed', async () => {
		const a = await dressedRecord();
		const { verdict, row } = await freshnessOf(a.id, NOW_PAST_DUE);
		expect(row).toMatchObject({ state: 'warn' });
		expect(row!.detail).toBe(`A claim on this record is past its promised date and has not been updated by its lender since ${TOUCH_DAY}. Revalidate before relying on it.`);
		expect(verdict).toBe('attention');
	});

	it('the date named is the stalest claim\'s, one claim\'s date, never a tally', async () => {
		const a = await dressedRecord();
		seedClaim(a.id, { amount: 100, affirmed_at: '2026-09-20 11:00:00', created_at: '2026-09-20 10:00:00', claim_date: '2026-09-20' });
		const { row } = await freshnessOf(a.id, NOW_PAST_DUE);
		expect(row!.detail).toContain('since 2026-09-20.');
	});

	it('lapsed: warn in the lapse wording, and the headroom check already reads the freed figure', async () => {
		const a = await dressedRecord();
		const r = await verify(a.id, NOW_LAPSED);
		if (!r.ok) throw new Error('not found');
		expect(r.checks.find((c) => c.key === 'freshness')).toMatchObject({ state: 'warn', detail: FRESHNESS_DETAIL_LAPSED });
		expect(r.checks.find((c) => c.key === 'headroom')).toMatchObject({ state: 'pass' });
		expect(r.verdict).toBe('attention');
		expect(r.receivable.claimed).toBe(0);
	});

	it('no promised date: the record cannot be aged, so it is a caution, not a silent pass', async () => {
		const a = await dressedRecord({ dueDate: undefined });
		const { verdict, row } = await freshnessOf(a.id, NOW_ACTIVE);
		expect(row).toMatchObject({ state: 'warn', detail: FRESHNESS_DETAIL_NO_DATE });
		expect(verdict).toBe('attention');
	});

	it('no active claims, no freshness check — the five-check shape stands', async () => {
		const a = await create(OWNER, { ...INVOICE, dueDate: '2026-10-20', details: { buyerRef: 'PO-00123' } });
		const r = await verify(a.id, NOW_ACTIVE);
		expect(r.ok && r.checks.map((c) => c.key)).toEqual(['integrity', 'headroom', 'duplicate', 'acknowledged', 'anchor']);
	});

	it('the stored re-verification keeps the freshness row, and no reason ever rides along (D3)', async () => {
		const a = await dressedRecord();
		const claim = fake.rows('receivable_claims').find((c) => c.receivable_id === a.id)!;
		await reg.addExtension(FIRST, String(claim.id), { newPromisedDate: '2026-10-22', reasonCode: 'other', reasonNote: 'zz-invented-reason-note' }, new Date('2026-10-21T00:00:00Z'));
		const r = await reg.reverifyReceivable(CHECKER, a.id, { now: new Date('2026-11-10T00:00:00Z') });
		if (!r.ok) throw new Error('not found');
		expect(r.checks.find((c) => c.key === 'freshness')).toMatchObject({ state: 'warn' });
		expect(JSON.stringify(r)).not.toContain('zz-invented-reason-note');
		const stored = fake.rows('receivable_reverifications').at(-1)!;
		const checks = JSON.parse(String(stored.checks_json)) as Array<{ key: string; state: string }>;
		expect(checks.find((c) => c.key === 'freshness')).toMatchObject({ state: 'warn' });
		expect(String(stored.checks_json)).not.toContain('zz-invented-reason-note');
		expect(JSON.parse(String(stored.manifest_json)).checks.map((c: any) => c.key)).toContain('freshness');
	});
});
