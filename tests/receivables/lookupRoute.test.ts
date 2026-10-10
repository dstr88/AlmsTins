import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GET /api/verify/receivables/lookup: the second financier's public check.
 *
 * Characterization first. These assertions were written and run green against the original
 * route (its own json() helper and its own never-evicting Map limiter) before the route moved
 * onto src/lib/http/publicApi.ts. Every error body, status and the JSON content type must stay
 * exactly as they were; the swap may only ADD headers (no-store, Retry-After, Allow), and must
 * never add CORS. The registry is mocked: this suite is about the route's own contract.
 */

const reg = vi.hoisted(() => ({
	status: vi.fn<(id: string) => Promise<any>>(),
}));
vi.mock('@/lib/receivablesRegistry', () => ({
	getReceivableStatus: (id: string) => reg.status(id),
}));

import { GET, POST } from '../../src/pages/api/verify/receivables/lookup';

const ID = 'ab'.repeat(32);

/** A distinct client per test, so one test's hits never spend another test's budget. */
let ipSeq = 0;
const nextIp = () => `198.51.100.${++ipSeq}`;

const call = async (id: string | null, ip = nextIp()) => {
	const url = new URL('https://almstins.com/api/verify/receivables/lookup');
	if (id !== null) url.searchParams.set('id', id);
	// Production sits behind Render's Cloudflare, which sets cf-connecting-ip and also makes
	// it the socket's clientAddress for the route. Both carry the same client here.
	const request = new Request(url, { headers: { 'cf-connecting-ip': ip } });
	const res: Response = await (GET as any)({ request, url, clientAddress: ip });
	return { res, body: await res.json() };
};

beforeEach(() => {
	reg.status.mockReset().mockResolvedValue(null);
});

describe('lookup: error bodies are pinned', () => {
	it('400 with the exact message when the ID is missing', async () => {
		const { res, body } = await call(null);
		expect(res.status).toBe(400);
		expect(body).toEqual({ ok: false, error: 'A valid receivable ID (64 hex chars) is required.' });
		expect(reg.status).not.toHaveBeenCalled();
	});

	it('400 with the exact message when the ID is not 64 hex characters', async () => {
		for (const bad of ['abc', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), ` ${ID}`]) {
			const { res, body } = await call(bad);
			expect(res.status).toBe(400);
			expect(body).toEqual({ ok: false, error: 'A valid receivable ID (64 hex chars) is required.' });
		}
		expect(reg.status).not.toHaveBeenCalled();
	});

	it('429 with the exact message once a client passes 30 lookups a minute', async () => {
		const ip = nextIp();
		for (let i = 0; i < 30; i++) {
			const { res } = await call(ID, ip);
			expect(res.status).toBe(200);
		}
		const { res, body } = await call(ID, ip);
		expect(res.status).toBe(429);
		expect(body).toEqual({ ok: false, error: 'Too many requests.' });
	});

	it('a second client keeps its own budget', async () => {
		const ip = nextIp();
		for (let i = 0; i < 31; i++) await call(ID, ip);
		const { res } = await call(ID, nextIp());
		expect(res.status).toBe(200);
	});

	it('500 lookup_failed when the registry throws, and never echoes the error', async () => {
		reg.status.mockRejectedValue(new Error('connection refused at 10.0.0.5'));
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { res, body } = await call(ID);
		spy.mockRestore();
		expect(res.status).toBe(500);
		expect(body).toEqual({ ok: false, error: 'lookup_failed' });
	});

	it('POST answers 405 with the exact message', async () => {
		const res: Response = await (POST as any)({ request: new Request('https://almstins.com/api/verify/receivables/lookup', { method: 'POST' }) });
		expect(res.status).toBe(405);
		expect(await res.json()).toEqual({ ok: false, error: 'Method not allowed' });
		expect(res.headers.get('content-type')).toBe('application/json');
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
	});
});

describe('lookup: answers', () => {
	it('found: false for an unknown ID, queried lowercase', async () => {
		const { res, body } = await call(ID.toUpperCase());
		expect(res.status).toBe(200);
		expect(body).toEqual({ ok: true, found: false, receivable: null });
		expect(reg.status).toHaveBeenCalledWith(ID);
	});

	it('found: true carries the registry status unchanged', async () => {
		const receivable = { id: ID, supplier: 'Acme', claims: [], attestations: [] };
		reg.status.mockResolvedValue(receivable);
		const { res, body } = await call(ID);
		expect(res.status).toBe(200);
		expect(body).toEqual({ ok: true, found: true, receivable });
	});
});

describe('lookup: headers', () => {
	it('every answer is JSON and carries no CORS header', async () => {
		const answers: Response[] = [];
		answers.push((await call(null)).res);
		answers.push((await call(ID)).res);
		reg.status.mockRejectedValue(new Error('x'));
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		answers.push((await call(ID)).res);
		spy.mockRestore();
		for (const res of answers) {
			expect(res.headers.get('content-type')).toBe('application/json');
			expect(res.headers.get('access-control-allow-origin')).toBeNull();
		}
	});
});

/**
 * Added with the swap to publicApi.ts. Everything above is unchanged from the characterization;
 * these pin what the swap added: headers only (no-store, Retry-After, Allow), and the limiter
 * bucket, which now follows the trusted client address (clientIpKey) instead of the socket.
 */
describe('lookup: after the publicApi swap (additive only)', () => {
	it('every answer is no-store', async () => {
		expect((await call(null)).res.headers.get('cache-control')).toBe('no-store');
		expect((await call(ID)).res.headers.get('cache-control')).toBe('no-store');
		const res: Response = await (POST as any)({ request: new Request('https://almstins.com/x', { method: 'POST' }) });
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(res.headers.get('allow')).toBe('GET');
	});

	it('429 says when to come back', async () => {
		const ip = nextIp();
		for (let i = 0; i < 30; i++) await call(ID, ip);
		const { res } = await call(ID, ip);
		expect(res.status).toBe(429);
		expect(res.headers.get('retry-after')).toBe('60');
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
	});

	it('the bucket is the client Cloudflare names, not the socket address', async () => {
		const url = new URL('https://almstins.com/api/verify/receivables/lookup');
		url.searchParams.set('id', ID);
		const hit = async (clientIp: string) => {
			const request = new Request(url, { headers: { 'cf-connecting-ip': clientIp } });
			return ((await (GET as any)({ request, url, clientAddress: '10.0.0.1' })) as Response).status;
		};
		const a = nextIp();
		for (let i = 0; i < 30; i++) expect(await hit(a)).toBe(200);
		expect(await hit(a)).toBe(429);
		// Same proxy socket, a different real client: its own budget.
		expect(await hit(nextIp())).toBe(200);
	});

	it('an IPv6 client is bucketed by its /64', async () => {
		const prefix = `2001:db8:${(++ipSeq).toString(16)}:1`;
		for (let i = 0; i < 30; i++) expect((await call(ID, `${prefix}::${(i + 1).toString(16)}`)).res.status).toBe(200);
		expect((await call(ID, `${prefix}::ffff`)).res.status).toBe(429);
	});
});
