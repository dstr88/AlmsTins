/**
 * An in-memory auth_users table that answers the statements the sign-in and activity code
 * writes (src/lib/accountActivity.ts, the address steps of src/lib/authLinkGuard.ts), so those
 * rules can be tested without a database. Each UPDATE applies its SET to exactly the row its
 * WHERE matches, the way Postgres would: a missing guard shows up as a changed row.
 *
 * One shared instance (`authUsers`), so a test file's `vi.mock('@/lib/db', …)` factory and its
 * test bodies reach the same rows:
 *
 *   vi.mock('@/lib/db', async () => (await import('../helpers/authUsersFake')).dbModule());
 *   import { authUsers } from '../helpers/authUsersFake';
 *
 * Every address in a test that uses it is invented.
 */

export type FakeUser = Record<string, unknown> & { id: string };
type Stmt = string | { sql: string; args?: unknown[] };

const squash = (sql: string) => sql.replace(/\s+/g, ' ').trim();

class AuthUsersFake {
	readonly rows = new Map<string, FakeUser>();
	/** Every statement run, squashed to one line. */
	readonly statements: Array<{ sql: string; args: unknown[] }> = [];
	/** The lazily added columns the database already has. */
	columns = new Set<string>(['signup_service', 'last_active_on']);
	/** A statement matching this throws, as a database error would. */
	failOn: RegExp | null = null;
	/** Answers for statements this fake does not know (return undefined to fall through). */
	extra: ((sql: string, args: unknown[]) => { rows: unknown[]; rowsAffected: number } | undefined) | null = null;

	reset(): void {
		this.rows.clear();
		this.statements.length = 0;
		this.columns = new Set(['signup_service', 'last_active_on']);
		this.failOn = null;
		this.extra = null;
	}

	add(user: FakeUser): FakeUser {
		const row = { ...user };
		this.rows.set(user.id, row);
		return row;
	}

	get(id: string): FakeUser {
		const row = this.rows.get(id);
		if (!row) throw new Error(`no fake user ${id}`);
		return row;
	}

	/** The statements that wrote (UPDATE or ALTER), for "nothing was written" assertions. */
	writes(): string[] {
		return this.statements.map((s) => s.sql).filter((sql) => /^(UPDATE|ALTER|INSERT|DELETE)\b/i.test(sql));
	}

	execute = async (stmt: Stmt): Promise<{ rows: unknown[]; rowsAffected: number }> => {
		const sql = squash(typeof stmt === 'string' ? stmt : stmt.sql);
		const args = (typeof stmt === 'string' ? [] : stmt.args) ?? [];
		this.statements.push({ sql, args });
		if (this.failOn?.test(sql)) throw new Error(`fake database error: ${sql.slice(0, 60)}`);

		const extra = this.extra?.(sql, args);
		if (extra) return extra;

		if (sql.startsWith('SELECT column_name FROM information_schema.columns')) {
			const asked = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((c) => c !== 'auth_users');
			return { rows: asked.filter((c) => this.columns.has(c)).map((c) => ({ column_name: c })), rowsAffected: 0 };
		}
		const update = (id: unknown, when: (u: FakeUser) => boolean, set: (u: FakeUser) => void) => {
			const u = this.rows.get(String(id));
			if (!u || !when(u)) return { rows: [], rowsAffected: 0 };
			set(u);
			return { rows: [], rowsAffected: 1 };
		};
		const empty = (v: unknown) => v === null || v === undefined || v === '';

		if (sql === 'UPDATE auth_users SET last_login_service = ?, last_login_country = ? WHERE id = ?') {
			return update(args[2], () => true, (u) => { u.last_login_service = args[0]; u.last_login_country = args[1]; });
		}
		if (sql === 'UPDATE auth_users SET last_login = ? WHERE id = ?') {
			return update(args[1], () => true, (u) => { u.last_login = args[0]; });
		}
		if (sql === 'UPDATE auth_users SET last_active_on = ? WHERE id = ? AND (last_active_on IS NULL OR last_active_on < ?)') {
			if (!this.columns.has('last_active_on')) throw new Error('column "last_active_on" does not exist');
			return update(args[1], (u) => empty(u.last_active_on) || String(u.last_active_on) < String(args[2]), (u) => { u.last_active_on = args[0]; });
		}
		if (sql === 'UPDATE auth_users SET signup_service = ? WHERE id = ? AND signup_service IS NULL') {
			if (!this.columns.has('signup_service')) throw new Error('column "signup_service" does not exist');
			return update(args[1], (u) => u.signup_service === null || u.signup_service === undefined, (u) => { u.signup_service = args[0]; });
		}
		if (sql === "UPDATE auth_users SET email = ? WHERE id = ? AND (email IS NULL OR email = '')") {
			return update(args[1], (u) => empty(u.email), (u) => { u.email = args[0]; });
		}
		if (sql.startsWith("UPDATE auth_users SET email_verified = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id = ? AND email = ?")) {
			return update(args[0], (u) => u.email === args[1] && empty(u.email_verified), (u) => { u.email_verified = '2026-11-05 12:00:00'; });
		}
		throw new Error(`unexpected SQL in test: ${sql}`);
	};

	batch = async (stmts: Stmt[]): Promise<Array<{ rows: unknown[]; rowsAffected: number }>> => {
		const out = [];
		for (const stmt of stmts) {
			const sql = squash(typeof stmt === 'string' ? stmt : stmt.sql);
			this.statements.push({ sql, args: [] });
			if (this.failOn?.test(sql)) throw new Error(`fake database error: ${sql.slice(0, 60)}`);
			const added = sql.match(/^ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS (\w+) /);
			if (added) this.columns.add(added[1]);
			else if (!sql.startsWith('SET LOCAL lock_timeout')) throw new Error(`unexpected batch SQL in test: ${sql}`);
			out.push({ rows: [], rowsAffected: 0 });
		}
		return out;
	};
}

export const authUsers = new AuthUsersFake();

/** What `vi.mock('@/lib/db', …)` returns. */
export const dbModule = () => ({ db: { execute: authUsers.execute, batch: authUsers.batch } });
