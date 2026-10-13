import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request tenant context for Postgres Row-Level Security.
//
// The app middleware establishes this around each authenticated route handler;
// the Postgres shim (db.pg.ts) reads it and sets `app.tenant_id` / `app.user_id`
// (transaction-locally) so RLS policies constrain the web role to this tenant's
// rows. Requests with no context (crons, background jobs, public pages) fall
// through to the owner pool, which bypasses RLS.
//
// AsyncLocalStorage propagates to async continuations, so `void task(tenantId)`
// background work spawned inside a handler inherits the same tenant context.

export interface DbRequestContext {
	tenantId: string | null;
	userId: string | null;
}

const storage = new AsyncLocalStorage<DbRequestContext>();

export function runWithDbContext<T>(ctx: DbRequestContext, fn: () => T): T {
	return storage.run(ctx, fn);
}

export function getDbContext(): DbRequestContext | undefined {
	return storage.getStore();
}

/**
 * Run `fn` with no request context, so its queries take the owner pool (the trusted path for
 * crons and background jobs) even when it is started from inside an authenticated request.
 * Async work `fn` starts does not inherit the caller's tenant either. For system jobs that must
 * read and write across tenants (the receivables fingerprint backfill), never for request work.
 */
export function runWithoutDbContext<T>(fn: () => T): T {
	return storage.exit(fn);
}
