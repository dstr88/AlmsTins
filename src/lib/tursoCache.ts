import { db } from '@/lib/db';

type CacheRow = {
	value_json?: string;
	expires_at?: number;
};

export async function getCache(key: string) {
	const result = await db.execute({
		sql: 'SELECT value_json, expires_at FROM cache WHERE cache_key = ? LIMIT 1',
		args: [key],
	});
	const row = result.rows?.[0] as CacheRow | undefined;
	if (!row) return null;
	const expiresAt = Number(row.expires_at ?? 0);
	if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt) {
		return null;
	}
	try {
		return JSON.parse(String(row.value_json ?? 'null'));
	} catch (error) {
		console.warn('[tursoCache] Failed to parse cached JSON', error);
		return null;
	}
}

export async function setCache(key: string, value: unknown, ttlSeconds: number) {
	const now = Date.now();
	const expiresAt = now + ttlSeconds * 1000;
	await db.execute({
		sql: `INSERT INTO cache (cache_key, value_json, expires_at, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(cache_key) DO UPDATE SET
				value_json = excluded.value_json,
				expires_at = excluded.expires_at,
				updated_at = excluded.updated_at`,
		args: [key, JSON.stringify(value), expiresAt, now],
	});
}
