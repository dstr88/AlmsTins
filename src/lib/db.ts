import { createClient } from '@libsql/client';

const url = import.meta.env.TURSO_DATABASE_URL;
const authToken = import.meta.env.TURSO_AUTH_TOKEN;
const loggedFlag = '__ledgerlense_db_name_logged__';
const pingFlag = '__ledgerlense_db_ping_logged__';

if (!url) {
	throw new Error('Missing TURSO_DATABASE_URL env var');
}

if (!authToken) {
	throw new Error('Missing TURSO_AUTH_TOKEN env var');
}

const globalAny = globalThis as typeof globalThis & { [loggedFlag]?: boolean; [pingFlag]?: boolean };
if (!globalAny[loggedFlag]) {
	globalAny[loggedFlag] = true;
	const dbName = url.replace(/^libsql:\/\//, '').split('.')[0] || 'unknown';
	console.log('[db] turso database', dbName);
}

const db = createClient({
	url,
	authToken,
});

if (!globalAny[pingFlag]) {
	globalAny[pingFlag] = true;
	db.execute('SELECT 1')
		.then(() => {
			console.log('[db] ping ok');
		})
		.catch((error) => {
			console.error('[db] ping failed', error instanceof Error ? error.message : String(error));
		});
}

export { db };
