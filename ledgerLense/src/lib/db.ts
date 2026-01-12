import { createClient } from '@libsql/client';

const url = import.meta.env.TURSO_DATABASE_URL;
const authToken = import.meta.env.TURSO_AUTH_TOKEN;

if (!url) {
	throw new Error('Missing TURSO_DATABASE_URL env var');
}

if (!authToken) {
	throw new Error('Missing TURSO_AUTH_TOKEN env var');
}

export const db = createClient({
	url,
	authToken,
});
