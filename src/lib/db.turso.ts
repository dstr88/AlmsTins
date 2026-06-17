import { createClient, type Client } from '@libsql/client';

// Turso / libSQL engine — the original database backend, kept as the default
// (and the instant rollback) while the Postgres migration is staged. db.ts
// selects this unless DB_ENGINE=pg. All connection logic that used to live at
// the top of db.ts now lives inside this factory so that merely importing the
// module never requires Turso env vars when the Postgres engine is selected.
export function makeTursoDb(): Client {
  const importMetaEnv = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;
  const env = { ...process.env, ...importMetaEnv };
  const url = env.TURSO_DATABASE_URL;
  const authToken = env.TURSO_AUTH_TOKEN;

  if (!url) throw new Error('Missing TURSO_DATABASE_URL');
  if (!authToken) throw new Error('Missing TURSO_AUTH_TOKEN');

  const loggedFlag = '__ledgerlense_db_name_logged__';
  const pingFlag = '__ledgerlense_db_ping_logged__';
  const globalAny = globalThis as typeof globalThis & { [loggedFlag]?: boolean; [pingFlag]?: boolean };

  if (!globalAny[loggedFlag]) {
    globalAny[loggedFlag] = true;
    const dbName = url.replace(/^libsql:\/\//, '').split('.')[0] || 'unknown';
    console.log('[db] turso database', dbName);
  }

  const db = createClient({ url, authToken });

  if (!globalAny[pingFlag]) {
    globalAny[pingFlag] = true;
    db.execute('PRAGMA foreign_keys = ON')
      .then(() => db.execute('SELECT 1'))
      .then(() => db.execute('PRAGMA foreign_keys'))
      .then((result) => {
        const value = Number((result.rows[0] as Record<string, unknown> | undefined)?.foreign_keys ?? 0);
        console.log('[db] ping ok');
        console.log('[db] foreign_keys', value === 1 ? 'on' : 'off');
        if (value !== 1) {
          console.warn('[db] WARNING: PRAGMA foreign_keys is OFF; cascading deletes and FK constraints may not behave as expected');
        }
      })
      .catch((error) => {
        console.error('[db] ping failed', error instanceof Error ? error.message : String(error));
      });
  }

  return db;
}
