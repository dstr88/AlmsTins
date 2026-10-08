import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The sign-up confirmation must work for someone who is not signed in: password sign-in
 * refuses an unverified address, and the session gate cuts an unverified password session,
 * so the person clicking the link never has a live session. If these paths ever fall
 * behind app.ts again, it 401s /api/verify-email before the handler runs and nobody can
 * verify. This runs the real src/middleware.ts (app.ts is replaced by a stub that fails
 * loudly, standing in for its 401).
 */
const appCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../src/middleware/geoblock', () => ({ getGeoblockResponse: async () => null }));
vi.mock('../../src/middleware/app', () => ({
	onRequest: async () => {
		appCalls.n += 1;
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
	},
}));

import { onRequest } from '../../src/middleware';
import { isPublicPath } from '../../src/middleware/auth';

const run = async (path: string, init: RequestInit = {}) => {
	const request = new Request(`https://almstins.com${path}`, init);
	const next = vi.fn(async () => new Response('handler', { status: 200 }));
	const res = (await (onRequest as any)({ request, url: new URL(request.url) }, next)) as Response;
	return { res, next };
};

beforeEach(() => {
	appCalls.n = 0;
});

describe('sign-up email confirmation is public', () => {
	it('isPublicPath lists the page and the endpoint', () => {
		expect(isPublicPath('/verify-email')).toBe(true);
		expect(isPublicPath('/api/verify-email')).toBe(true);
	});

	it('a signed-out GET of the emailed link reaches the handler', async () => {
		const { res, next } = await run('/api/verify-email?token=abc&email=a%40company.dev');
		expect(next).toHaveBeenCalledTimes(1);
		expect(res.status).toBe(200);
		expect(appCalls.n).toBe(0);
	});

	it('the confirmation page and the Confirm POST reach their handlers, even with a (cut) session cookie', async () => {
		const cookie = { cookie: '__Secure-authjs.session-token=cut-session' };
		expect((await run('/verify-email?token=abc&email=a%40company.dev', { headers: cookie })).next).toHaveBeenCalledTimes(1);
		const post = await run('/api/verify-email', {
			method: 'POST',
			headers: { ...cookie, 'content-type': 'application/x-www-form-urlencoded' },
			body: 'token=abc&email=a%40company.dev&lang=en',
		});
		expect(post.next).toHaveBeenCalledTimes(1);
		expect(appCalls.n).toBe(0);
	});

	it('the confirmation page gets the security headers', async () => {
		const { res } = await run('/verify-email?token=abc&email=a%40company.dev');
		expect(res.headers.get('X-Frame-Options')).toBe('DENY');
	});

	it('control: a tenant API still goes through app.ts', async () => {
		const { res, next } = await run('/api/verify/receivables/send', { method: 'POST' });
		expect(next).not.toHaveBeenCalled();
		expect(res.status).toBe(401);
		expect(appCalls.n).toBe(1);
	});
});
