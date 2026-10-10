import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createFixedWindowLimiter } from '../../src/lib/rateLimit';
import {
	PUBLIC_JSON_HEADERS,
	admitByIp,
	methodNotAllowed,
	publicJson,
	tooManyRequests,
} from '../../src/lib/http/publicApi';

/**
 * src/lib/http/publicApi.ts: the shell the public JSON endpoints share. JSON, no-store, and no
 * CORS unless an endpoint adds it itself; 429 and 405 keep the endpoint's own body.
 */

const req = (headers: Record<string, string> = {}) => new Request('https://almstins.com/api/x', { headers });

describe('publicJson', () => {
	it('JSON, no-store, no CORS', async () => {
		const res = publicJson({ ok: true, n: 1 });
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/json');
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
		expect(await res.json()).toEqual({ ok: true, n: 1 });
	});

	it('takes a status and extra headers', () => {
		const res = publicJson({ ok: false }, 503, { 'Retry-After': '30' });
		expect(res.status).toBe(503);
		expect(res.headers.get('retry-after')).toBe('30');
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	it('the shared headers cannot be mutated by a caller', () => {
		expect(Object.isFrozen(PUBLIC_JSON_HEADERS)).toBe(true);
		expect(Object.keys(PUBLIC_JSON_HEADERS).map((k) => k.toLowerCase())).not.toContain('access-control-allow-origin');
	});
});

describe('tooManyRequests / methodNotAllowed', () => {
	it('429 keeps the body and sends whole-second Retry-After, at least 1', async () => {
		const res = tooManyRequests({ ok: false, error: 'Too many requests.' }, 60);
		expect(res.status).toBe(429);
		expect(res.headers.get('retry-after')).toBe('60');
		expect(await res.json()).toEqual({ ok: false, error: 'Too many requests.' });
		expect(tooManyRequests({}, 0.2).headers.get('retry-after')).toBe('1');
		expect(tooManyRequests({}, 2.1).headers.get('retry-after')).toBe('3');
	});

	it('405 keeps the body and names the allowed methods', async () => {
		const res = methodNotAllowed({ ok: false, error: 'Method not allowed' }, 'GET');
		expect(res.status).toBe(405);
		expect(res.headers.get('allow')).toBe('GET');
		expect(await res.json()).toEqual({ ok: false, error: 'Method not allowed' });
	});
});

describe('admitByIp', () => {
	const over = { body: { ok: false, error: 'slow down' }, retryAfterSeconds: 60 };

	it('admits until the bucket is over its budget, then answers 429', async () => {
		const limiter = createFixedWindowLimiter({ windowMs: 60_000, max: 2 });
		const r = req({ 'cf-connecting-ip': '203.0.113.7' });
		expect(admitByIp(limiter, r, over)).toBeNull();
		expect(admitByIp(limiter, r, over)).toBeNull();
		const res = admitByIp(limiter, r, over)!;
		expect(res.status).toBe(429);
		expect(await res.json()).toEqual(over.body);
	});

	it('buckets by the trusted client address, an IPv6 address by its /64', () => {
		const limiter = createFixedWindowLimiter({ windowMs: 60_000, max: 1 });
		expect(admitByIp(limiter, req({ 'cf-connecting-ip': '2001:db8:1:2::a' }), over)).toBeNull();
		// Same /64, fresh host address: same budget.
		expect(admitByIp(limiter, req({ 'cf-connecting-ip': '2001:db8:1:2::b' }), over)?.status).toBe(429);
		// A different client keeps its own.
		expect(admitByIp(limiter, req({ 'cf-connecting-ip': '2001:db8:9:9::a' }), over)).toBeNull();
		expect(admitByIp(limiter, req({ 'cf-connecting-ip': '203.0.113.9' }), over)).toBeNull();
	});

	it('ignores a spoofable leftmost X-Forwarded-For when Cloudflare named the client', () => {
		const limiter = createFixedWindowLimiter({ windowMs: 60_000, max: 1 });
		expect(admitByIp(limiter, req({ 'cf-connecting-ip': '203.0.113.20', 'x-forwarded-for': '1.1.1.1' }), over)).toBeNull();
		expect(admitByIp(limiter, req({ 'cf-connecting-ip': '203.0.113.20', 'x-forwarded-for': '2.2.2.2' }), over)?.status).toBe(429);
	});
});

describe('publicApi.ts dependencies', () => {
	it('is built only on rateLimit.ts (and agentKeys.ts once the keyed tier lands)', () => {
		const src = fs.readFileSync(fileURLToPath(new URL('../../src/lib/http/publicApi.ts', import.meta.url)), 'utf8');
		const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
		for (const i of imports) expect(['@/lib/rateLimit', '@/lib/agentKeys']).toContain(i);
	});
});
