/**
 * The two sign-in token tables: signup_verification_tokens (the password sign-up's
 * /verify-email link) and auth_verification_tokens (Auth.js magic links). Both were only
 * ever created by the pre-Postgres migrations (migrations/0005_auth.sql and
 * 0007_auth_credentials.sql), so a Postgres database may not have them. Created on first
 * use; mirrors migrations-pg/0048_auth_token_tables.sql.
 *
 * Looks before it creates, and never touches a table that already exists (or its indexes):
 * CREATE UNIQUE INDEX IF NOT EXISTS still needs ownership and locks the table even when
 * the index is there. Remembers only success. Losing a first-use race to another request
 * (23505 on the catalog, or 42P07 already exists) counts as success.
 */
import { db } from './db';

export type TokenTable = 'signup_verification_tokens' | 'auth_verification_tokens';

const ready = new Map<TokenTable, Promise<void>>();

async function tableExists(table: TokenTable): Promise<boolean> {
	const res = await db.execute({ sql: 'SELECT to_regclass(?) AS r', args: [table] });
	return (res.rows[0] as Record<string, unknown> | undefined)?.r != null;
}

async function tolerateCreateRace(run: () => Promise<unknown>): Promise<void> {
	try {
		await run();
	} catch (err) {
		const code = (err as { code?: string } | null)?.code;
		if (code === '23505' || code === '42P07') return;
		throw err;
	}
}

async function createIfMissing(table: TokenTable): Promise<void> {
	if (await tableExists(table)) return;
	await tolerateCreateRace(() => db.execute({
		sql: `CREATE TABLE IF NOT EXISTS ${table} (
		        identifier TEXT NOT NULL,
		        token      TEXT NOT NULL,
		        expires    TEXT NOT NULL
		      )`,
		args: [],
	}));
	await tolerateCreateRace(() => db.execute({
		sql: `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_idx ON ${table} (identifier, token)`,
		args: [],
	}));
}

export function ensureTokenTable(table: TokenTable): Promise<void> {
	let pending = ready.get(table);
	if (!pending) {
		pending = createIfMissing(table).catch((err: unknown) => {
			ready.delete(table);
			throw err;
		});
		ready.set(table, pending);
	}
	return pending;
}
