/**
 * POST /api/tax-login
 *
 * Verifies the submitted passphrase against TAX_SECRET.
 * On success: sets tax_session cookie and redirects to /tax.
 * On failure: redirects back to /tax-login?error=1.
 */

import type { APIRoute } from 'astro';
import { expectedTaxToken, grantCookie } from '@/lib/taxAuth';
import crypto from 'node:crypto';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
	const form       = await request.formData();
	const passphrase = String(form.get('passphrase') ?? '').trim();

	const expected = expectedTaxToken();

	// Compare submitted passphrase against TAX_SECRET env var
	const secret = (process.env.TAX_SECRET ?? (import.meta.env as Record<string, string>).TAX_SECRET) || '';

	let valid = false;
	if (secret && passphrase && passphrase.length === secret.length) {
		try {
			valid = crypto.timingSafeEqual(
				Buffer.from(passphrase),
				Buffer.from(secret),
			);
		} catch {
			valid = false;
		}
	} else if (secret && passphrase) {
		// Different lengths — still do a dummy compare to prevent timing attacks
		try { crypto.timingSafeEqual(Buffer.from('a'), Buffer.from('b')); } catch {}
		valid = false;
	}

	if (!valid || !expected) {
		return redirect('/tax-login?error=1', 303);
	}

	return new Response(null, {
		status: 303,
		headers: {
			Location:    '/year-summary',
			'Set-Cookie': grantCookie(expected),
		},
	});
};
