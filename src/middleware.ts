/**
 * Middleware entry point
 *
 * Auth/public paths are handled HERE with a pure pass-through before any
 * app logic runs. This means changes to app.ts can NEVER break login —
 * the auth handler is completely unreachable from the app middleware layer.
 *
 *   isPublicPath?  → next()            (route handler only, no app logic)
 *   else           → appMiddleware()   (session, tenant, analytics, headers)
 */

import { defineMiddleware } from 'astro/middleware';
import { isPublicPath } from './middleware/auth';
import { onRequest as appMiddleware } from './middleware/app';

export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname } = new URL(context.request.url);

	// Auth + public paths: pure pass-through.
	// app.ts never runs — its bugs cannot affect login.
	if (isPublicPath(pathname)) {
		return next();
	}

	return appMiddleware(context, next);
});
