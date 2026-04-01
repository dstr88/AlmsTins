/**
 * GET /api/demo/start
 *
 * Sets the demo session cookie and redirects the visitor to the bookkeeping
 * dashboard, which is the most impressive page to land on with data already
 * populated.  No auth required — this endpoint is in isPublicPath().
 */

import type { APIRoute } from 'astro';
import { demoCookieSet } from '../../../lib/demo';

export const GET: APIRoute = async ({ redirect }) => {
	return new Response(null, {
		status: 302,
		headers: {
			Location: '/dashboard/bookkeeping',
			'Set-Cookie': demoCookieSet(),
		},
	});
};
