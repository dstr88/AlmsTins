import { describe, it, expect, vi } from 'vitest';
import { json } from '../../src/lib/http';
import { json as vaultJson } from '../../src/lib/agentVault/api';

// agentVault/api.ts reaches the database through its session helpers; only json() is used here.
vi.mock('@/lib/requireTenantSession', () => ({}));
vi.mock('@/lib/agenticsAccess', () => ({}));

/**
 * src/lib/http.ts replaced about 125 local json() helpers (Area 7 of the shared pieces
 * refactor). Each local variant is copied here verbatim, and the shared call each route now
 * makes must give exactly the same Response: status, statusText, every header and the body
 * bytes. If a case here fails, a route's answer changed.
 */

// ── The local copies, as they were ─────────────────────────────────────────────

// Plain (about 100 routes): `status = 200` or a required `status: number`.
const oldPlain = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Pretty (the crons, verify-record): JSON.stringify(body, null, 2).
function oldPretty(body: unknown, status = 200) {
	return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}

// No-store (history-by-wallet, export, address-history, analytics.json, agent crons, ...).
const oldNoStore = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});

// verify/check.ts: no-store + open CORS, plus per-call extras (Retry-After).
const CHECK_HEADERS = {
	'Content-Type': 'application/json',
	'Cache-Control': 'no-store',
	'Access-Control-Allow-Origin': '*',
};
const oldCheck = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { ...CHECK_HEADERS, ...extra } });

// year-summary/proof-bundle.ts: pretty, plus per-call extras (Content-Disposition).
const oldProofBundle = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
	new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json', ...extra } });

// aave-rates.ts: CORS headers that also carry the content type.
function corsHeaders() {
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
		'Content-Type': 'application/json',
	};
}
function oldAaveRates(body: unknown, status: number) {
	return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

// src/lib/agentVault/api.ts before it delegated.
const oldVault = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...headers },
	});


// ── Comparison ────────────────────────────────────────────────────────────────

async function snapshot(res: Response) {
	return {
		status: res.status,
		statusText: res.statusText,
		ok: res.ok,
		headers: [...res.headers.entries()],
		body: new Uint8Array(await res.arrayBuffer()),
	};
}

async function same(a: Response, b: Response) {
	expect(await snapshot(b)).toEqual(await snapshot(a));
}

const BODIES: unknown[] = [
	{ ok: true },
	{ ok: false, error: 'not_found', detail: { id: 'abc', n: [1, 2.5, -0] } },
	{ text: 'café — 日本   "quoted" </script>', nested: { a: null, b: undefined, c: [] } },
	[1, 'two', { three: 3 }],
	'a bare string',
	42,
	null,
	undefined,
	{ when: new Date(Date.UTC(2026, 9, 25, 12, 0, 0)), big: 1e21 },
];
const STATUSES = [200, 201, 400, 401, 403, 404, 409, 410, 429, 500, 503];

describe('json() matches every local variant it replaced', () => {
	it('plain, with the status given or left out', async () => {
		for (const body of BODIES) {
			await same(oldPlain(body), json(body));
			for (const s of STATUSES) await same(oldPlain(body, s), json(body, s));
		}
	});

	it('pretty', async () => {
		for (const body of BODIES) {
			await same(oldPretty(body), json(body, 200, { pretty: true }));
			for (const s of STATUSES) await same(oldPretty(body, s), json(body, s, { pretty: true }));
		}
	});

	it('no-store', async () => {
		for (const body of BODIES) {
			await same(oldNoStore(body), json(body, 200, { noStore: true }));
			for (const s of STATUSES) await same(oldNoStore(body, s), json(body, s, { noStore: true }));
		}
	});

	it('verify/check.ts: no-store, CORS and extras', async () => {
		const CORS = { 'Access-Control-Allow-Origin': '*' };
		for (const body of BODIES) {
			await same(oldCheck(body), json(body, 200, { noStore: true, headers: CORS }));
			await same(oldCheck(body, 405), json(body, 405, { noStore: true, headers: CORS }));
			await same(
				oldCheck(body, 429, { 'Retry-After': '60' }),
				json(body, 429, { noStore: true, headers: { ...CORS, 'Retry-After': '60' } }),
			);
		}
	});

	it('year-summary/proof-bundle.ts: pretty with extras', async () => {
		const cd = { 'Content-Disposition': 'attachment; filename="almstins-2025-proof.json"' };
		for (const body of BODIES) {
			await same(oldProofBundle(body, 400), json(body, 400, { pretty: true }));
			await same(oldProofBundle(body, 200, cd), json(body, 200, { pretty: true, headers: cd }));
		}
	});

	it('aave-rates.ts: CORS headers carrying the content type', async () => {
		for (const body of BODIES) {
			for (const s of STATUSES) await same(oldAaveRates(body, s), json(body, s, { headers: corsHeaders() }));
		}
	});

	it('agentVault json, now built on json()', async () => {
		const extra = { 'Retry-After': '60' };
		for (const body of BODIES) {
			await same(oldVault(body), vaultJson(body));
			await same(oldVault(body, 429, extra), vaultJson(body, 429, extra));
		}
	});

	it('a header given in the same spelling replaces the default, as the spread did', async () => {
		const res = json({ ok: true }, 200, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
		expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
	});

	it('an explicit undefined status falls back to 200, like the local defaults', async () => {
		await same(oldPlain({ ok: true }, undefined), json({ ok: true }, undefined));
	});
});
