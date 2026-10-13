import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * /dashboard/yearEnd/gains returned an empty 500 to the owner on production. Its frontmatter
 * did `await fetch(new URL('/api/yearEnd/summary?...', Astro.request.url))`: a server-side
 * fetch of its own API with no session cookie, through whatever host Astro.request.url named
 * on Render, and a throw there escaped the page.
 *
 * The summary is now src/lib/yearEndSummary.ts, called in-process by both the API route and
 * the page, with the session's tenant, behind the owner gate. A failure renders the page's
 * error banner (null), never a throw.
 *
 * Hermetic: the session, the database, the cache, the price feed and the annual breakdown are
 * stubs.
 */

const state = vi.hoisted(() => ({ session: null as null | { tenantId: string; isDemo?: boolean } }));
const data = vi.hoisted(() => ({
	dbExecute: vi.fn(async (_stmt: unknown) => ({ rows: [] as Record<string, unknown>[], rowsAffected: 0 })),
	buildAnnualBreakdown: vi.fn(async (_tenantId: string, _year: number) => ({
		shortTerm: [] as unknown[],
		longTerm: [] as unknown[],
		stillHolding: [] as unknown[],
		needsAttention: [] as unknown[],
		availableYears: [] as number[],
		dataSource: 'lifecycle',
		totals: { shortTermGain: 0, longTermGain: 0, totalIncome: 0 },
	})),
	getCache: vi.fn(async () => ({ value: null as object | null, isStale: false })),
	setCache: vi.fn(async () => {}),
	getTickersUSD: vi.fn(async () => []),
}));

vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => state.session }));
vi.mock('@/lib/db', () => ({ db: { execute: data.dbExecute } }));
vi.mock('@/lib/annualBreakdown', () => ({ buildAnnualBreakdown: data.buildAnnualBreakdown }));
vi.mock('@/lib/tursoCache', () => ({ getCache: data.getCache, setCache: data.setCache }));
vi.mock('@/lib/coinpaprikaProvider', () => ({ getTickersUSD: data.getTickersUSD }));

import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { getYearEndSummary, isValidSummaryYear, parseSummaryMethod } from '../../src/lib/yearEndSummary';
import { GET as summaryGET } from '../../src/pages/api/yearEnd/summary';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

// Each test uses its own year: the summary keeps an in-process cache per tenant + year + method.
let nextYear = 2010;
const freshYear = () => nextYear++;

beforeEach(() => {
	state.session = null;
	for (const fn of Object.values(data)) (fn as ReturnType<typeof vi.fn>).mockClear();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the gains page builds the summary in-process', () => {
	const page = read('src/pages/dashboard/yearEnd/gains.astro');
	const frontmatter = page.slice(0, page.indexOf('---', 3));

	it('does not fetch its own API from the server', () => {
		expect(frontmatter).not.toMatch(/\bfetch\(/);
		expect(frontmatter).not.toMatch(/['"`]\/api\/yearEnd\/summary/); // no URL to its own API
		expect(frontmatter).not.toMatch(/Astro\.request\.url/);
	});

	it('calls getYearEndSummary with the session tenant, after the owner gate, inside try/catch', () => {
		const gate = frontmatter.indexOf('if (!(await hasTaxAccess(Astro.request))) return Astro.redirect(TAX_DENIED_REDIRECT, 302);');
		const call = frontmatter.indexOf('getYearEndSummary(session.tenantId, year, method)');
		expect(gate).toBeGreaterThan(-1);
		expect(call).toBeGreaterThan(gate);
		expect(frontmatter).toMatch(/try \{\s*const session = await requireTenantSession\(Astro\.request\);[\s\S]*getYearEndSummary\(session\.tenantId, year, method\)[\s\S]*\} catch \(err\) \{/);
		expect(frontmatter).toMatch(/let data: TaxPayload = \{ ok: false \};/);
	});

	it('the summary API route delegates to the same function and keeps no query logic of its own', () => {
		const route = read('src/pages/api/yearEnd/summary.ts');
		expect(route).toMatch(/import \{[^}]*\bgetYearEndSummary\b[^}]*\} from '@\/lib\/yearEndSummary'/);
		expect(route).not.toMatch(/db\.execute\(|buildAnnualBreakdown\(/);
	});
});

describe('getYearEndSummary', () => {
	it('builds the payload for a tenant and year', async () => {
		const year = freshYear();
		const summary = await getYearEndSummary(OWNER_TENANT_ID, year, 'fifo');
		expect(summary).toMatchObject({ ok: true, year, method: 'fifo', cached: false });
		expect(data.buildAnnualBreakdown).toHaveBeenCalledWith(OWNER_TENANT_ID, year, 'fifo', undefined, 'auto');
		expect(data.setCache).toHaveBeenCalledTimes(1);
	});

	it('serves the second call for the same tenant, year and method from memory', async () => {
		const year = freshYear();
		await getYearEndSummary(OWNER_TENANT_ID, year, 'hifo');
		data.buildAnnualBreakdown.mockClear();
		const again = await getYearEndSummary(OWNER_TENANT_ID, year, 'hifo');
		expect(again).toMatchObject({ ok: true, cached: true });
		expect(data.buildAnnualBreakdown).not.toHaveBeenCalled();
	});

	it('returns null instead of throwing when the database fails', async () => {
		data.dbExecute.mockRejectedValueOnce(new Error('connection refused'));
		await expect(getYearEndSummary(OWNER_TENANT_ID, freshYear(), 'fifo')).resolves.toBeNull();
	});

	it('returns null instead of throwing when the lot engine fails', async () => {
		data.buildAnnualBreakdown.mockRejectedValueOnce(new Error('engine failed'));
		await expect(getYearEndSummary(OWNER_TENANT_ID, freshYear(), 'fifo')).resolves.toBeNull();
	});

	it('parses the method and validates the year the way the route always did', () => {
		expect(parseSummaryMethod('hifo')).toBe('hifo');
		expect(parseSummaryMethod('lifo')).toBe('lifo');
		expect(parseSummaryMethod('spec_id')).toBe('spec_id');
		expect(parseSummaryMethod('bogus')).toBe('fifo');
		expect(parseSummaryMethod(null)).toBe('fifo');
		expect(isValidSummaryYear(2025)).toBe(true);
		expect(isValidSummaryYear(2008)).toBe(false);
		expect(isValidSummaryYear(2101)).toBe(false);
		expect(isValidSummaryYear(Number('abc'))).toBe(false);
	});
});

describe('GET /api/yearEnd/summary through the shared function', () => {
	const call = (query: string) => {
		const url = new URL(`https://almstins.com/api/yearEnd/summary${query}`);
		return (summaryGET as unknown as (ctx: unknown) => Promise<Response>)({ request: new Request(url), url, params: {} });
	};

	it('answers the owner with the summary', async () => {
		state.session = { tenantId: OWNER_TENANT_ID };
		const year = freshYear();
		const res = await call(`?year=${year}&method=lifo`);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, year, method: 'lifo' });
	});

	it('answers a failed build with a JSON 500 that has a body', async () => {
		state.session = { tenantId: OWNER_TENANT_ID };
		data.dbExecute.mockRejectedValueOnce(new Error('connection refused'));
		const res = await call(`?year=${freshYear()}`);
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ ok: false, error: 'Unable to build tax summary.' });
	});

	it('rejects an invalid year with 400 before building anything', async () => {
		state.session = { tenantId: OWNER_TENANT_ID };
		const res = await call('?year=1999');
		expect(res.status).toBe(400);
		expect(data.buildAnnualBreakdown).not.toHaveBeenCalled();
	});

	it('still gives a non-owner the generic 404 without reading data', async () => {
		state.session = { tenantId: 'tenant-a' };
		const res = await call(`?year=${freshYear()}`);
		expect(res.status).toBe(404);
		expect(data.dbExecute).not.toHaveBeenCalled();
		expect(data.getCache).not.toHaveBeenCalled();
	});
});
