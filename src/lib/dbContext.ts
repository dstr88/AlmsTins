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
