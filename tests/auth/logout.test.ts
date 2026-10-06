import { describe, it, expect } from 'vitest';
import { GET, POST } from '@/pages/api/logout';

/**
 * /api/logout is where every logout button lands (src/components/LogoutButton.astro posts
 * here). It clears the Auth.js cookies, then redirects:
 *   - POST: to the form's `next` field when that is a same-origin path, else /login;
 *   - GET: the same, from the `next` query parameter (kept for links that already exist).
 * The destination is untrusted input, so an off-site, protocol-relative, backslash or
 * encoded-slash value must never become a redirect. The cookies are cleared either way.
 */
type Cleared = { name: string; secure: boolean };

async function call(handler: typeof GET, request: Request) {
	const cleared: Cleared[] = [];
	const cookies = {
		delete: (name: string, opts?: { secure?: boolean }) => {
			cleared.push({ name, secure: !!opts?.secure });
		},
	};
	const redirect = (location: string, status = 302) =>
		new Response(null, { status, headers: { Location: location } });
	const res = (await handler({ request, cookies, redirect } as any)) as Response;
	return { res, cleared, location: res.headers.get('Location') };
}

const url = 'https://almstins.com/api/logout';
const post = (fields?: Record<string, string>) =>
	new Request(url, { method: 'POST', body: fields ? new URLSearchParams(fields) : undefined });

describe('POST /api/logout', () => {
	it('signs out: every Auth.js cookie is cleared, with and without the secure flag', async () => {
		const { cleared } = await call(POST, post());
		for (const name of ['authjs.session-token', '__Secure-authjs.session-token', '__Host-authjs.session-token']) {
			expect(cleared).toContainEqual({ name, secure: false });
			expect(cleared).toContainEqual({ name, secure: true });
		}
	});

	it('lands on the sign-in page when no destination is posted', async () => {
		const { res, location } = await call(POST, post());
		expect(res.status).toBe(303);
		expect(location).toBe('/login');
	});

	it('lands where the form says when it is a same-origin path', async () => {
		for (const next of ['/verify', '/receivables', '/petro-tins', '/api/demo/start']) {
			const { res, location } = await call(POST, post({ next }));
			expect(res.status, next).toBe(303);
			expect(location, next).toBe(next);
		}
	});

	it('keeps the query of a same-origin destination (the Verify desks sign out to their own login)', async () => {
		const { location } = await call(POST, post({ next: '/verify/login?next=/verify/desk' }));
		expect(location).toBe('/verify/login?next=/verify/desk');
	});

	it.each([
		['//evil.com'],
		['https://evil.com/x'],
		['/\\evil.com'],
		['/%5Cevil.com'],
		['/%2F%2Fevil.com'],
		['/.//evil.com'],
		['javascript:alert(1)'],
		['verify'],
		[''],
	])('ignores an unsafe destination %j and still signs out', async (next) => {
		const { res, location, cleared } = await call(POST, post({ next }));
		expect(res.status).toBe(303);
		expect(location).toBe('/login');
		expect(cleared.length).toBeGreaterThan(0);
	});

	it('does not choke on a body that is not a form', async () => {
		const json = new Request(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ next: '/verify' }),
		});
		const { res, location, cleared } = await call(POST, json);
		expect(res.status).toBe(303);
		expect(location).toBe('/login');
		expect(cleared.length).toBeGreaterThan(0);
	});

	it('ignores a destination sent as a file upload', async () => {
		const fd = new FormData();
		fd.append('next', new Blob(['/verify']), 'next.txt');
		const { location } = await call(POST, new Request(url, { method: 'POST', body: fd }));
		expect(location).toBe('/login');
	});
});

describe('GET /api/logout (existing links)', () => {
	it('signs out and lands on the sign-in page by default', async () => {
		const { res, location, cleared } = await call(GET, new Request(url));
		expect(res.status).toBe(303);
		expect(location).toBe('/login');
		expect(cleared.length).toBeGreaterThan(0);
	});

	it('honors a same-origin ?next=', async () => {
		const { location } = await call(GET, new Request(`${url}?next=${encodeURIComponent('/verify')}`));
		expect(location).toBe('/verify');
	});

	it('refuses an off-site ?next=', async () => {
		const { location } = await call(GET, new Request(`${url}?next=${encodeURIComponent('//evil.com')}`));
		expect(location).toBe('/login');
	});
});
