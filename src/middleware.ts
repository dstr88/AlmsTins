/**
 * Middleware entry point
 *
 * Two-layer design:
 *
 *   1. auth   (src/middleware/auth.ts)
 *      ↳ Owns the public-path definition. Intentionally minimal.
 *        Changes here are rare and only concern which paths bypass auth.
 *
 *   2. app    (src/middleware/app.ts)
 *      ↳ Session checks, tenant routing, security headers, analytics.
 *        This layer can change freely without risking the login flow.
 *
 * Both layers import isPublicPath() from auth.ts — one definition, no drift.
 */

import { sequence } from 'astro/middleware';
import { onRequest as authGuard } from './middleware/auth';
import { onRequest as appLogic } from './middleware/app';

export const onRequest = sequence(authGuard, appLogic);
