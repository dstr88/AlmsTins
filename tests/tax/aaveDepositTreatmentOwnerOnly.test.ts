import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * POST /api/tax/aave-deposit-treatment stores the tenant's Aave-deposit choice, which feeds
 * the gain/loss figures. Those are tax documents, so the route is the owner's alone, like
 * every other tax route (src/lib/taxAuth.ts, tests/tax/taxDocsOwnerOnly.test.ts):
 *
 *   - anyone who is not the owner (a signed-in account, a demo session, nobody) gets the
 *     generic 404 and the data layer is never touched;
 *   - the owner passes and the choice is stored for the owner's tenant;
 *   - source pins: every route under src/pages/api/tax/ calls the gate first, and the one
 *     page that calls this route checks the owner before it renders.
 *
 * Hermetic: the session and the data layer are stubs.
 */

const state = vi.hoisted(() => ({
	session: null as null | { tenantId: string; isDemo?: boolean },
}));

const data = vi.hoisted(() => ({
	setAaveDepositTax: vi.fn(async () => {}),
	dbExecute: vi.fn(async () => ({ rows: [], rowsAffected: 0 })),
}));

vi.mock('@/lib/requireTenantSession', () => ({
	requireTenantSession: async () => state.session,
}));
vi.mock('@/lib/jurisdictionProfile', () => ({ setAaveDepositTax: data.setAaveDepositTax }));
vi.mock('@/lib/db', () => ({ db: { execute: data.dbExecute, batch: vi.fn(async () => []) } }));

import { POST } from '../../src/pages/api/tax/aave-deposit-treatment';
import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { DEMO_TENANT_ID } from '../../src/lib/demo';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const post = (body: unknown) => {
	const request = new Request('https://almstins.com/api/tax/aave-deposit-treatment', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	return (POST as any)({ request, url: new URL(request.url) }) as Promise<Response>;
};

beforeEach(() => {
	state.session = null;
	data.setAaveDepositTax.mockClear();
	data.dbExecute.mockClear();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('POST /api/tax/aave-deposit-treatment is owner only', () => {
	it.each([
		['a signed-in account', { tenantId: 'tenant-a' }],
		['a demo session', { tenantId: DEMO_TENANT_ID, isDemo: true }],
		['a demo session that carries the owner tenant', { tenantId: OWNER_TENANT_ID, isDemo: true }],
		['nobody signed in', null],
	] as const)('%s gets the generic 404 and the data layer is untouched', async (_who, session) => {
		state.session = session as typeof state.session;
		const res = await post({ treatment: 'tax_event' });
		expect(res.status).toBe(404);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(await res.json()).toEqual({ error: 'Not found' });
		expect(data.setAaveDepositTax).not.toHaveBeenCalled();
		expect(data.dbExecute).not.toHaveBeenCalled();
	});

	it.each(['tax_event', 'undecided', 'not_tax_event'])('the owner stores %s for the owner tenant', async (treatment) => {
		state.session = { tenantId: OWNER_TENANT_ID };
		const res = await post({ treatment });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, treatment });
		expect(data.setAaveDepositTax).toHaveBeenCalledTimes(1);
		expect(data.setAaveDepositTax).toHaveBeenCalledWith(OWNER_TENANT_ID, treatment);
	});

	it('the owner still gets a 400 for a value outside the three choices', async () => {
		state.session = { tenantId: OWNER_TENANT_ID };
		const res = await post({ treatment: 'maybe' });
		expect(res.status).toBe(400);
		expect(data.setAaveDepositTax).not.toHaveBeenCalled();
	});
});

describe('source pins: tax routes and the page that calls this one', () => {
	const DIR = 'src/pages/api/tax';
	const files = readdirSync(path.join(ROOT, DIR))
		.filter((n) => statSync(path.join(ROOT, DIR, n)).isFile() && /\.(ts|js|mjs)$/.test(n))
		.map((n) => `${DIR}/${n}`);

	it('finds the route files', () => {
		expect(files).toContain('src/pages/api/tax/aave-deposit-treatment.ts');
	});

	it.each(files.map((f) => [f]))('%s calls the owner gate first in every handler', (file) => {
		const src = read(file);
		expect(src).toMatch(/import \{[^}]*\brequireTaxOwner\b[^}]*\} from '[^']*lib\/taxAuth'/);
		const handlers = [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE|ALL)\b/g)].map((m) => m[1]);
		expect(handlers.length, file).toBeGreaterThan(0);
		for (const method of handlers) {
			expect(src, `${file} ${method}`).toMatch(
				new RegExp(
					`export const ${method}: APIRoute = async \\([^)]*\\) => \\{\\s*const denied = await requireTaxOwner\\(request\\);[^\\n]*\\n\\s*if \\(denied\\) return denied;`,
				),
			);
		}
	});

	it('every page that calls the route checks the owner before it renders', () => {
		const pages: string[] = [];
		const walk = (rel: string) => {
			for (const name of readdirSync(path.join(ROOT, rel))) {
				const child = `${rel}/${name}`;
				if (statSync(path.join(ROOT, child)).isDirectory()) walk(child);
				else if (/\.(astro|ts|tsx|js|mjs)$/.test(name)) pages.push(child);
			}
		};
		walk('src');
		const callers = pages.filter((f) => f !== 'src/pages/api/tax/aave-deposit-treatment.ts' && read(f).includes('/api/tax/aave-deposit-treatment'));
		expect(callers).toEqual(['src/pages/year-summary.astro']);
		for (const page of callers) {
			const src = read(page);
			const frontmatter = src.slice(0, src.indexOf('---', 3));
			expect(frontmatter, page).toContain(
				'if (!(await hasTaxAccess(Astro.request))) return Astro.redirect(TAX_DENIED_REDIRECT, 302);',
			);
		}
	});
});
