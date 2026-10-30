import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Tax documents are the owner's alone (owner decision, Oct 12 2026: Almstins is not tax
 * software). Tax documents = the Form 8949 and Schedule D views and data, the gains, lots,
 * review and report pages, 1099 upload / list / reconciliation, the tax documents store, the
 * Annual Records PDF, and every CSV of gains, losses or lots (TurboTax, shortTerm, longTerm,
 * stillHolding). The gate is requireTaxOwner() / hasTaxAccess() in src/lib/taxAuth.ts.
 *
 *   - Every locked API answers anyone who is not the owner (a signed-in account, a demo
 *     session, or nobody) with the same generic 404, and never reaches its data layer.
 *   - The owner passes through.
 *   - The Year Summary PDF and proof bundle still go to Unlimited (unchanged), and the
 *     bookkeeping Needs Attention and Income CSVs (no basis, gain/loss or term) still go to
 *     any paid plan.
 *   - Source pins: every route file under src/pages/api/yearEnd/ calls the gate (one named
 *     exemption), a sweep of src/pages finds any other route that touches tax-document data
 *     without the gate (named allowlist), no page sends anyone to the removed /tax-login
 *     passphrase gate, and the hardening in this change stays in place.
 *
 * Hermetic: the session, the database and every data-layer module are stubs.
 */

const state = vi.hoisted(() => ({
	session: null as null | { tenantId: string; isDemo?: boolean },
	plan: 'pro',
	sessionLookups: 0,
}));

// Every data-layer entry point the locked routes can reach. None may run for a non-owner.
const data = vi.hoisted(() => ({
	dbExecute: vi.fn(async (stmt: string | { sql: string }) => {
		const sql = typeof stmt === 'string' ? stmt : stmt.sql;
		if (/FROM tax_documents WHERE id = \?/.test(sql)) {
			return { rows: [{ id: 'doc-1', filename: 'a"b.pdf', mime_type: 'application/pdf', file_data: 'eA==' }], rowsAffected: 0 };
		}
		return { rows: [], rowsAffected: 0 };
	}),
	dbBatch: vi.fn(async () => []),
	buildAnnualBreakdown: vi.fn(async () => ({
		shortTerm: [], longTerm: [], needsAttention: [], stillHolding: [], income: [], cardRebates: [],
	})),
	getActivePlan: vi.fn(async () => ({ id: state.plan })),
	getCache: vi.fn(async () => ({ value: null })),
	setCache: vi.fn(async () => {}),
	runTaxPipeline: vi.fn(async () => ({ ok: true })),
	runDuplicateSweep: vi.fn(async () => ({ ok: true })),
	setDuplicateOverride: vi.fn(async () => ({ ok: true })),
	getTickersUSD: vi.fn(async () => ({})),
	pdfParse: vi.fn(async () => ({ text: '' })),
	getLatestRecordId: vi.fn(async () => 'rec-1'),
	getStoredRecord: vi.fn(async () => ({
		manifest: { period: '2025', signing_key_id: 'k' }, signatureHex: null, leaves: [], leafHashes: [],
	})),
	getLatestRoot: vi.fn(async () => null),
	persistRecordProof: vi.fn(async () => {}),
}));

vi.mock('@/lib/requireTenantSession', () => ({
	requireTenantSession: async () => {
		state.sessionLookups++;
		return state.session;
	},
}));
vi.mock('@/lib/authSession', () => ({
	getAuthSession: async () => (state.session ? { user: { id: 'user-1' }, tenantId: state.session.tenantId } : null),
}));
vi.mock('@/lib/db', () => ({ db: { execute: data.dbExecute, batch: data.dbBatch } }));
vi.mock('@/lib/annualBreakdown', () => ({ buildAnnualBreakdown: data.buildAnnualBreakdown }));
vi.mock('@/lib/subscriptions', () => ({ getActivePlan: data.getActivePlan }));
vi.mock('@/lib/tursoCache', () => ({ getCache: data.getCache, setCache: data.setCache }));
vi.mock('@/lib/yearEnd/classify', () => ({ runTaxPipeline: data.runTaxPipeline }));
vi.mock('@/lib/yearEnd/deduplication', () => ({
	runDuplicateSweep: data.runDuplicateSweep,
	setDuplicateOverride: data.setDuplicateOverride,
}));
vi.mock('@/lib/coinpaprikaProvider', () => ({ getTickersUSD: data.getTickersUSD }));
// pdf-parse 2.x: a PDFParse class, no default export (the upload route loads it lazily).
vi.mock('pdf-parse', () => ({
	PDFParse: class {
		getText() { return data.pdfParse(); }
		async destroy() {}
	},
}));
vi.mock('@/lib/recordProof/store', () => ({
	getLatestRecordId: data.getLatestRecordId,
	getStoredRecord: data.getStoredRecord,
	getLatestRoot: data.getLatestRoot,
	persistRecordProof: data.persistRecordProof,
}));

import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { DEMO_TENANT_ID } from '../../src/lib/demo';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const dataCalls = () =>
	Object.values(data).reduce((n, fn) => n + (fn as ReturnType<typeof vi.fn>).mock.calls.length, 0);

type Route = {
	file: string; // under src/pages/api/yearEnd/
	method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
	query?: string;
	params?: Record<string, string>;
	json?: unknown;
	form?: boolean;
	/** The owner's request is complete enough to reach the data layer. */
	ownerReachesData?: boolean;
};

// Every locked handler. A new handler under src/pages/api/yearEnd/ must be added here
// (the "covers every handler" test below fails otherwise).
const LOCKED: Route[] = [
	{ file: 'form8949.ts', method: 'GET', query: '?year=2025&method=fifo', ownerReachesData: true },
	{ file: 'summary.ts', method: 'GET', query: '?year=2025&method=fifo', ownerReachesData: true },
	{ file: '1099/upload.ts', method: 'POST', form: true },
	{ file: '1099/list.ts', method: 'GET', ownerReachesData: true },
	{ file: '1099/reconciliation.ts', method: 'GET', query: '?uploadId=up-1', ownerReachesData: true },
	{ file: 'documents/index.ts', method: 'GET', query: '?year=2025', ownerReachesData: true },
	{ file: 'documents/index.ts', method: 'POST', form: true },
	{ file: 'documents/[id].ts', method: 'GET', params: { id: 'doc-1' }, ownerReachesData: true },
	{ file: 'documents/[id].ts', method: 'DELETE', params: { id: 'doc-1' }, ownerReachesData: true },
	{ file: 'review/resolve.ts', method: 'POST', json: { reviewItemId: 'r1', sourceType: 'import', sourceId: 's1', category: 'sale' } },
	{ file: 'lot-pins.ts', method: 'GET', query: '?year=2025', ownerReachesData: true },
	{ file: 'lot-pins.ts', method: 'POST', json: {} },
	{ file: 'lot-pins.ts', method: 'DELETE', json: {} },
	{ file: 'classify.ts', method: 'POST', json: { year: 2025 }, ownerReachesData: true },
	{ file: 'deduplicate.ts', method: 'POST', json: {} },
	{ file: 'deduplicate.ts', method: 'PATCH', json: {} },
	{ file: 'cost-basis.ts', method: 'GET', ownerReachesData: true },
	{ file: 'opening-positions.ts', method: 'GET' },
	{ file: 'opening-positions.ts', method: 'POST', json: {} },
	{ file: 'opening-positions.ts', method: 'DELETE', query: '?asset=BTC' },
	{ file: 'manual-basis.ts', method: 'GET', ownerReachesData: true },
	{ file: 'manual-basis.ts', method: 'POST', json: {} },
	{ file: 'manual-basis.ts', method: 'DELETE', json: {} },
	{ file: 'breakdown-csv.ts', method: 'GET', query: '?section=turbotax&year=2025', ownerReachesData: true },
	{ file: 'breakdown-csv.ts', method: 'GET', query: '?section=shortTerm&year=2025', ownerReachesData: true },
	{ file: 'breakdown-csv.ts', method: 'GET', query: '?section=longTerm&year=2025', ownerReachesData: true },
	{ file: 'breakdown-csv.ts', method: 'GET', query: '?section=stillHolding&year=2025', ownerReachesData: true },
	{ file: 'breakdown-csv.ts', method: 'GET', query: '?year=2025', ownerReachesData: true }, // defaults to shortTerm
];

const modules = import.meta.glob('../../src/pages/api/yearEnd/**/*.ts');

async function call(route: Route): Promise<Response> {
	const load = modules[`../../src/pages/api/yearEnd/${route.file}`];
	if (!load) throw new Error(`no module for ${route.file}`);
	const mod = (await load()) as Record<string, (ctx: unknown) => Promise<Response>>;
	const url = new URL(`https://almstins.com/api/yearEnd/${route.file.replace(/\.ts$/, '')}${route.query ?? ''}`);
	let init: RequestInit = { method: route.method };
	if (route.json !== undefined) {
		init = { ...init, headers: { 'content-type': 'application/json' }, body: JSON.stringify(route.json) };
	} else if (route.form) {
		const fd = new FormData();
		fd.set('file', new File(['date,asset\n'], '1099.csv', { type: 'text/csv' }));
		fd.set('taxYear', '2025');
		init = { ...init, body: fd };
	}
	const request = new Request(url, init);
	return mod[route.method]({ request, url, params: route.params ?? {} });
}

const isGate404 = async (res: Response) =>
	res.status === 404 &&
	res.headers.get('Cache-Control') === 'no-store' &&
	(await res.clone().text()) === JSON.stringify({ error: 'Not found' });

const label = (r: Route) => `${r.method} ${r.file}${r.query ?? ''}`;

beforeEach(() => {
	state.session = null;
	state.plan = 'pro';
	state.sessionLookups = 0;
	for (const fn of Object.values(data)) (fn as ReturnType<typeof vi.fn>).mockClear();
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('locked tax-document APIs refuse everyone but the owner', () => {
	const NON_OWNERS: Array<[string, null | { tenantId: string; isDemo?: boolean }]> = [
		['a signed-in account on a paid plan', { tenantId: 'tenant-a' }],
		['a demo session', { tenantId: DEMO_TENANT_ID, isDemo: true }],
		['a demo session that carries the owner tenant', { tenantId: OWNER_TENANT_ID, isDemo: true }],
		['nobody signed in', null],
	];

	for (const [who, session] of NON_OWNERS) {
		it.each(LOCKED.map((r) => [label(r), r] as const))(`${who}: %s → generic 404, data layer untouched`, async (_l, route) => {
			state.session = session;
			state.plan = 'unlimited'; // even the top plan does not open a tax document
			const res = await call(route);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({ error: 'Not found' });
			expect(res.headers.get('Cache-Control')).toBe('no-store');
			expect(dataCalls()).toBe(0);
		});
	}

	it.each(LOCKED.map((r) => [label(r), r] as const))('the owner passes the gate: %s', async (_l, route) => {
		state.session = { tenantId: OWNER_TENANT_ID };
		let res: Response | null = null;
		try {
			res = await call(route);
		} catch {
			// A stubbed data layer can make a handler throw after the gate; that is past the gate.
		}
		if (res) expect(await isGate404(res)).toBe(false);
		expect(state.sessionLookups).toBeGreaterThan(1); // the handler resolved the session again
		if (route.ownerReachesData) expect(dataCalls()).toBeGreaterThan(0);
	});

	it('the owner download of a stored document is never cached', async () => {
		state.session = { tenantId: OWNER_TENANT_ID };
		const res = await call({ file: 'documents/[id].ts', method: 'GET', params: { id: 'doc-1' } });
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(res.headers.get('Content-Disposition')).toBe('inline; filename="a_b.pdf"');
	});
});

describe('bookkeeping CSVs: gain/loss and lot sections are tax documents, the record lists are not', () => {
	const csv = (section: string) =>
		({ file: 'breakdown-csv.ts', method: 'GET', query: `?section=${section}&year=2025` }) as Route;

	it.each(['needsAttention', 'income'])('a paid non-owner still downloads %s', async (section) => {
		state.session = { tenantId: 'tenant-a' };
		state.plan = 'starter';
		const res = await call(csv(section));
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toMatch(/text\/csv/);
	});

	it('a free account still gets the paid-plan answer for a record list, not the owner 404', async () => {
		state.session = { tenantId: 'tenant-a' };
		state.plan = 'free';
		const res = await call(csv('income'));
		expect(res.status).toBe(403);
		expect(data.buildAnnualBreakdown).not.toHaveBeenCalled();
	});

	it.each(['turbotax', 'shortTerm', 'longTerm', 'stillHolding', 'all', 'somethingNew'])(
		'the %s section is refused before the plan or the data is read',
		async (section) => {
			state.session = { tenantId: 'tenant-a' };
			state.plan = 'unlimited';
			const res = await call(csv(section));
			expect(await isGate404(res)).toBe(true);
			expect(data.getActivePlan).not.toHaveBeenCalled();
			expect(data.buildAnnualBreakdown).not.toHaveBeenCalled();
		},
	);

	it('the owner gets the TurboTax CSV', async () => {
		state.session = { tenantId: OWNER_TENANT_ID };
		const res = await call(csv('turbotax'));
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Disposition')).toMatch(/turbotax-form8949-2025\.csv/);
	});

	it.each([
		['shortTerm', 'short-term'],
		['longTerm', 'long-term'],
		['stillHolding', 'still-holding'],
	])('the owner gets the %s CSV', async (section, slug) => {
		state.session = { tenantId: OWNER_TENANT_ID };
		const res = await call(csv(section));
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Disposition')).toContain(`almstins-2025-${slug}.csv`);
	});

	it('every link to the CSV route names a section the route serves (no "all")', () => {
		const route = read('src/pages/api/yearEnd/breakdown-csv.ts');
		const served = new Set([...route.matchAll(/^\s*case '(\w+)':/gm)].map((m) => m[1]));
		expect([...served].sort()).toEqual(['income', 'longTerm', 'needsAttention', 'shortTerm', 'stillHolding', 'turbotax']);
		const sources = listFiles('src').filter((f) => /\.(astro|ts|tsx|js|mjs)$/.test(f) && !f.endsWith('breakdown-csv.ts'));
		const linked: Array<[string, string]> = [];
		for (const f of sources) {
			for (const m of read(f).matchAll(/breakdown-csv\?[^`'"\s]*section=(\w+)/g)) linked.push([f, m[1]]);
			if (f === 'src/pages/dashboard/bookkeeping.astro') {
				for (const m of read(f).matchAll(/csvBase\('(\w+)'\)/g)) linked.push([f, m[1]]);
			}
		}
		expect(linked.length).toBeGreaterThanOrEqual(7); // turbotax on Form 8949 + the six Bookkeeping buttons
		for (const [file, section] of linked) expect(served.has(section), `${file}: section=${section}`).toBe(true);
	});

	it('Bookkeeping shows the gain/loss and lot CSV buttons to the owner only', () => {
		const page = read('src/pages/dashboard/bookkeeping.astro');
		const buttons = [...page.matchAll(/^\s*(.*)<a href=\{csvBase\('(\w+)'\)\}/gm)].map((m) => [m[2], m[1]] as const);
		expect(buttons.map(([section]) => section).sort()).toEqual(
			['income', 'longTerm', 'needsAttention', 'shortTerm', 'shortTerm', 'stillHolding'],
		);
		for (const [section, prefix] of buttons) {
			if (section === 'needsAttention' || section === 'income') expect(prefix, section).toBe('');
			else expect(prefix, section).toBe('{canTax && ');
		}
	});
});

describe('the Annual Records PDF and page are tax documents', () => {
	const report = async () => {
		const { GET } = await import('../../src/pages/api/annual-records/report');
		const request = new Request('https://almstins.com/api/annual-records/report?year=2025');
		return (GET as any)({ request, url: new URL(request.url) }) as Promise<Response>;
	};

	it.each([
		['a signed-in account on a paid plan', { tenantId: 'tenant-a' }],
		['a demo session that carries the owner tenant', { tenantId: OWNER_TENANT_ID, isDemo: true }],
		['nobody signed in', null],
	] as const)('%s → generic 404, data layer untouched', async (_who, session) => {
		state.session = session as typeof state.session;
		state.plan = 'unlimited';
		const res = await report();
		expect(await isGate404(res)).toBe(true);
		expect(dataCalls()).toBe(0);
	});

	it('the owner passes the gate', async () => {
		state.session = { tenantId: OWNER_TENANT_ID };
		data.buildAnnualBreakdown.mockRejectedValueOnce(new Error('stop after the gate'));
		const res = await report();
		expect(await isGate404(res)).toBe(false);
		expect(data.buildAnnualBreakdown).toHaveBeenCalledTimes(1);
	});
});

describe('the Year Summary stays on Unlimited (unchanged)', () => {
	const report = async () => {
		const { GET } = await import('../../src/pages/api/year-summary/report');
		const request = new Request('https://almstins.com/api/year-summary/report?year=2025');
		return (GET as any)({ request, url: new URL(request.url) }) as Promise<Response>;
	};
	const bundle = async () => {
		const { GET } = await import('../../src/pages/api/year-summary/proof-bundle');
		const request = new Request('https://almstins.com/api/year-summary/proof-bundle?year=2025');
		return (GET as any)({ request, url: new URL(request.url) }) as Promise<Response>;
	};

	it('an Unlimited non-owner passes the PDF gate', async () => {
		state.session = { tenantId: 'tenant-a' };
		state.plan = 'unlimited';
		data.buildAnnualBreakdown.mockRejectedValueOnce(new Error('stop after the gate'));
		const res = await report();
		expect(data.buildAnnualBreakdown).toHaveBeenCalledTimes(1);
		expect([403, 404]).not.toContain(res.status);
	});

	it('a Pro non-owner is told the PDF is on Unlimited', async () => {
		state.session = { tenantId: 'tenant-a' };
		state.plan = 'pro';
		const res = await report();
		expect(res.status).toBe(403);
		expect((await res.json()).planRequired).toBe('unlimited');
		expect(data.buildAnnualBreakdown).not.toHaveBeenCalled();
	});

	it('an Unlimited non-owner gets the proof bundle', async () => {
		state.session = { tenantId: 'tenant-a' };
		state.plan = 'unlimited';
		const res = await bundle();
		expect(res.status).toBe(200);
		expect(data.getStoredRecord).toHaveBeenCalledWith('tenant-a', 'rec-1');
	});

	it('a Pro non-owner is told the proof bundle is on Unlimited', async () => {
		state.session = { tenantId: 'tenant-a' };
		state.plan = 'pro';
		const res = await bundle();
		expect(res.status).toBe(403);
		expect(data.getStoredRecord).not.toHaveBeenCalled();
	});
});

// ── Source pins ─────────────────────────────────────────────────────────────

const API_DIR = 'src/pages/api/yearEnd';

function listFiles(rel: string): string[] {
	const abs = path.join(ROOT, rel);
	return readdirSync(abs).flatMap((name) => {
		const childRel = `${rel}/${name}`;
		return statSync(path.join(ROOT, childRel)).isDirectory() ? listFiles(childRel) : [childRel];
	});
}

const HANDLER = /export const (GET|POST|PUT|PATCH|DELETE|ALL)\b/g;

// The one route under src/pages/api/yearEnd/ that is deliberately NOT owner-gated, and why.
const EXEMPT: Record<string, string> = {
	'completeness.ts': 'an in-app figure: the record-completeness bar on every user\'s Bookkeeping page',
};

describe('source pins: every yearEnd API calls the owner gate', () => {
	const files = listFiles(API_DIR).filter((f) => /\.(ts|js|mjs)$/.test(f));
	const rel = (f: string) => f.slice(API_DIR.length + 1);

	it('finds the route files', () => {
		expect(files.length).toBeGreaterThanOrEqual(15);
	});

	it('the exemption list names only files that exist', () => {
		for (const name of Object.keys(EXEMPT)) expect(existsSync(path.join(ROOT, API_DIR, name)), name).toBe(true);
	});

	it.each(files.map((f) => [f]))('%s imports requireTaxOwner and gates every handler', (file) => {
		const src = read(file);
		const name = rel(file);
		if (EXEMPT[name]) {
			expect(src).not.toMatch(/form8949|tax_documents|tax_1099|turbotax/i);
			return;
		}
		expect(src).toMatch(/import \{[^}]*\brequireTaxOwner\b[^}]*\} from '[^']*lib\/taxAuth'/);
		const handlers = [...src.matchAll(HANDLER)].map((m) => m[1]);
		expect(handlers.length, name).toBeGreaterThan(0);

		if (name === 'breakdown-csv.ts') {
			// Only the two record-list sections skip the gate (an allowlist, so a new section is
			// locked by default); everything else is gated before the plan or any data is read.
			expect(src).toMatch(/const PAID_PLAN_SECTIONS: ReadonlySet<string> = new Set\(\['needsAttention', 'income'\]\);/);
			const gate = src.indexOf('if (!PAID_PLAN_SECTIONS.has(section)) {\n      const denied = await requireTaxOwner(request);\n      if (denied) return denied;');
			expect(gate).toBeGreaterThan(-1);
			expect(gate).toBeLessThan(src.indexOf('requireTenantSession(request)'));
			expect(gate).toBeLessThan(src.indexOf('getActivePlan('));
			expect(gate).toBeLessThan(src.indexOf('buildAnnualBreakdown('));
			return;
		}

		// The gate is the first statement of every handler.
		for (const method of handlers) {
			const re = new RegExp(
				`export const ${method}: APIRoute = async \\([^)]*\\) => \\{\\s*const denied = await requireTaxOwner\\(request\\);[^\\n]*\\n\\s*if \\(denied\\) return denied;`,
			);
			expect(src, `${name} ${method}`).toMatch(re);
		}
	});

	it('the behavior table above covers every gated handler', () => {
		const gated = files
			.filter((f) => !EXEMPT[rel(f)])
			.flatMap((f) => [...read(f).matchAll(HANDLER)].map((m) => `${m[1]} ${rel(f)}`))
			.sort();
		const covered = [...new Set(LOCKED.map((r) => `${r.method} ${r.file}`))].sort();
		expect(covered).toEqual(gated);
	});
});

describe('source pins: tax pages and the removed passphrase gate', () => {
	const pages = listFiles('src/pages').filter((f) => f.endsWith('.astro'));

	it('the TAX_SECRET passphrase path is gone', () => {
		expect(existsSync(path.join(ROOT, 'src/pages/api/tax-login.ts'))).toBe(false);
		const auth = read('src/lib/taxAuth.ts');
		expect(auth).not.toMatch(/process\.env\.TAX_SECRET|createHmac|grantCookie|tax_session/);
		expect(read('src/pages/tax-login.astro')).not.toMatch(/<form|passphrase"/);
	});

	it('no page sends anyone to /tax-login', () => {
		for (const page of pages) expect(read(page), page).not.toMatch(/redirect\(\s*['"`]\/tax-login/);
	});

	const TAX_PAGES = [
		'src/pages/dashboard/yearEnd/1099.astro',
		'src/pages/dashboard/yearEnd/form8949.astro',
		'src/pages/dashboard/yearEnd/schedule-d.astro',
		'src/pages/dashboard/yearEnd/gains.astro',
		'src/pages/dashboard/yearEnd/lots.astro',
		'src/pages/dashboard/yearEnd/opening-positions.astro',
		'src/pages/dashboard/yearEnd/identifications.astro',
		'src/pages/dashboard/yearEnd/report.astro',
		'src/pages/dashboard/yearEnd/review.astro',
		'src/pages/year-summary.astro',
		'src/pages/dashboard/annual-records.astro',
	];

	it.each(TAX_PAGES.map((p) => [p]))('%s checks the owner before it reads anything', (page) => {
		const src = read(page);
		const frontmatter = src.slice(0, src.indexOf('---', 3));
		const gate = frontmatter.indexOf('if (!(await hasTaxAccess(Astro.request))) return Astro.redirect(TAX_DENIED_REDIRECT, 302);');
		expect(gate).toBeGreaterThan(-1);
		for (const op of ['buildAnnualBreakdown(', 'getYearEndSummary(', 'db.execute(', 'fetch(']) {
			const at = frontmatter.indexOf(op);
			if (at > -1) expect(gate, `${page}: gate before ${op}`).toBeLessThan(at);
		}
	});

	it('every page under dashboard/yearEnd is gated, except the in-app history page and the redirect hub', () => {
		const dir = listFiles('src/pages/dashboard/yearEnd').filter((f) => f.endsWith('.astro'));
		const notGated = dir.filter((f) => !TAX_PAGES.includes(f)).sort();
		expect(notGated).toEqual(['src/pages/dashboard/yearEnd/index.astro', 'src/pages/dashboard/yearEnd/memory-lane.astro']);
		expect(read('src/pages/dashboard/yearEnd/index.astro')).toMatch(/hasTaxAccess\(Astro\.request\)\) \? '\/year-summary' : TAX_DENIED_REDIRECT/);
	});

	it('/tax is only the redirect: the owner to the Year Summary, everyone else to Bookkeeping', () => {
		const src = read('src/pages/tax.astro');
		expect(src).toMatch(/import \{ hasTaxAccess, TAX_DENIED_REDIRECT \} from '@\/lib\/taxAuth';/);
		expect(src).toMatch(/return Astro\.redirect\(\(await hasTaxAccess\(Astro\.request\)\) \? '\/year-summary' : TAX_DENIED_REDIRECT, 302\);/);
		// Nothing after the redirect: no template, no unreachable old page.
		const end = src.indexOf('---', 3);
		expect(src.slice(src.indexOf('return Astro.redirect('), end).split('\n').filter((l) => l.trim())).toHaveLength(1);
		expect(src.slice(end + 3).trim()).toBe('');
	});

	it('the vault digest pill links to the review page only for the owner', () => {
		const vault = read('src/pages/dashboard/vault.astro');
		expect(vault).toMatch(/const digestHref = !tenant\.isDemo && tenantHasTaxAccess\(tenantId\) \? '\/dashboard\/yearEnd\/review' : '\/dashboard\/bookkeeping';/);
		expect(vault).not.toMatch(/href="\/dashboard\/yearEnd\/review"/);
	});

	it('TAX_DENIED_REDIRECT is Bookkeeping, which every signed-in user can open', async () => {
		const { TAX_DENIED_REDIRECT } = await import('../../src/lib/taxAuth');
		expect(TAX_DENIED_REDIRECT).toBe('/dashboard/bookkeeping');
	});
});

describe('source pins: tax-document routes outside src/pages/api/yearEnd', () => {
	it('the Annual Records PDF calls the owner gate first', () => {
		const src = read('src/pages/api/annual-records/report.ts');
		expect(src).toMatch(/import \{[^}]*\brequireTaxOwner\b[^}]*\} from '[^']*lib\/taxAuth'/);
		expect(src).toMatch(
			/export const GET: APIRoute = async \([^)]*\) => \{\s*(\/\/[^\n]*\n\s*)*const denied = await requireTaxOwner\(request\);[^\n]*\n\s*if \(denied\) return denied;/,
		);
		expect(src).not.toMatch(/isOwner\(/);
	});

	// Any route or page that touches tax-document data must call the owner gate, or be named
	// here with the reason it is not a tax document. A new tax route anywhere under src/pages
	// (src/pages/api/tax/, a new directory, ...) fails this sweep until it is gated or listed.
	const TAX_DOC_MARKER = /form8949|turbotax|tax_documents|tax_1099_|tax_review_items|schedule-d/i;
	const SCHEDULE_D_IDENT = /\bscheduleD\b/; // case-sensitive: "scheduled" is not a tax document
	const READS_GAINS_OR_LOTS = /\.(shortTerm|longTerm|stillHolding)\b/;
	const ALLOWED: Record<string, string> = {
		'src/pages/dashboard/bookkeeping.astro':
			'in-app figures every user sees; its gain/loss and lot CSV buttons render for the owner only (pinned above)',
		'src/pages/dashboard/yearEnd/memory-lane.astro': 'in-app history page (per-asset totals), no download',
		'src/pages/api/year-summary/report.ts': 'the Year Summary PDF: Unlimited or owner (src/lib/yearSummaryAccess.ts)',
		'src/pages/api/reconciliation/index.ts': 'in-app reconciliation tin: held quantity per asset vs live balances, no lots',
		'src/pages/api/yearEnd/completeness.ts': "in-app figure: the record-completeness bar on every user's Bookkeeping page",
		'src/pages/api/cron/monthly-digest.ts': 'CRON_SECRET job: counts unresolved review items into each tenant digest',
		'src/pages/api/import/batches.ts': "deletes the tenant's own review rows when an import batch is undone; serves no tax data",
	};
	const GATE = /\brequireTaxOwner\(|\bhasTaxAccess\(/;

	const touchesTaxDocs = (src: string) =>
		TAX_DOC_MARKER.test(src) || SCHEDULE_D_IDENT.test(src) || (src.includes('buildAnnualBreakdown(') && READS_GAINS_OR_LOTS.test(src));

	const candidates = listFiles('src/pages').filter(
		(f) => f.endsWith('.astro') || (f.startsWith('src/pages/api/') && /\.(ts|js|mjs)$/.test(f)),
	);

	it('finds the known tax-document routes (the sweep is looking in the right place)', () => {
		const hits = candidates.filter((f) => touchesTaxDocs(read(f)));
		for (const f of [
			'src/pages/api/yearEnd/form8949.ts',
			'src/pages/api/yearEnd/breakdown-csv.ts',
			'src/pages/api/annual-records/report.ts',
			'src/pages/dashboard/annual-records.astro',
			'src/pages/dashboard/yearEnd/schedule-d.astro',
		]) {
			expect(hits).toContain(f);
		}
	});

	it('every allowlisted file exists, still touches tax-document data, and calls no gate', () => {
		for (const f of Object.keys(ALLOWED)) {
			expect(existsSync(path.join(ROOT, f)), f).toBe(true);
			const src = read(f);
			expect(touchesTaxDocs(src), f).toBe(true);
			expect(GATE.test(src), `${f} is gated now; drop it from the allowlist`).toBe(false);
		}
	});

	it('every other route or page that touches tax-document data calls the owner gate', () => {
		const offenders = candidates.filter((f) => {
			if (ALLOWED[f]) return false;
			const src = read(f);
			return touchesTaxDocs(src) && !GATE.test(src);
		});
		expect(offenders).toEqual([]);
	});
});

describe('source pins: tenant predicates on the two JOINs', () => {
	it('the income query joins import_transactions within the tenant', () => {
		expect(read('src/lib/annualBreakdown.ts')).toMatch(
			/LEFT JOIN import_transactions it\s+ON it\.id = tc\.source_id AND tc\.source_type = 'import'\s+AND it\.tenant_id = tc\.tenant_id/,
		);
	});

	it('the bookkeeping transaction history joins transactions within the tenant', () => {
		expect(read('src/pages/api/bookkeeping/transaction-history.ts')).toMatch(
			/LEFT JOIN transactions t\s+ON e\.source_id = t\.id\s+AND t\.tenant_id = e\.tenant_id/,
		);
	});
});
