/**
 * GET /api/demo/end
 *
 * Clears the demo session cookie and redirects to the login page.
 * No auth required — this endpoint is in isPublicPath().
 */

import type { APIRoute } from 'astro';
import { demoCookieClear } from '../../../lib/demo';

export const GET: APIRoute = async () => {
	return new Response(null, {
		status: 302,
		headers: {
			Location: '/login',
			'Set-Cookie': demoCookieClear(),
		},
	});
};
