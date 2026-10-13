import { db } from '@/lib/db';

type CacheRow = {
	value_json?: string;
	expires_at?: number;
	updated_at?: number;
};

type DbRow = Record<string, unknown>;

function toCacheRow(row: unknown): CacheRow | null {
	if (!row || typeof row !== 'object') return null;
	const r = row as DbRow;
	return {
		value_json: typeof r.value_json === 'string' ? r.value_json : undefined,
		expires_at: typeof r.expires_at === 'number' ? r.expires_at : undefined,
		updated_at: typeof r.updated_at === 'number' ? r.updated_at : undefined,
	};
}

type CacheRead<T> = {
	value: T | null;
	isStale: boolean;
	updatedAt?: number | null;
	expiresAt?: number | null;
};

export async function getCache<T = unknown>(
	key: string,
	options: { allowStale: true; staleMaxAgeSeconds?: number },
): Promise<CacheRead<T>>;
export async function getCache<T = unknown>(
	key: string,
	options?: { allowStale?: false; staleMaxAgeSeconds?: number },
): Promise<T | null>;
export async function getCache<T = unknown>(
	key: string,
	options?: { allowStale?: boolean; staleMaxAgeSeconds?: number },
): Promise<T | CacheRead<T> | null> {
	const result = await db.execute({
		sql: 'SELECT value_json, expires_at, updated_at FROM cache WHERE cache_key = ? LIMIT 1',
		args: [key],
	});
	const row = toCacheRow(result.rows?.[0]) ?? undefined;
	if (!row) {
		return options?.allowStale
			? { value: null, isStale: false, updatedAt: null, expiresAt: null }
			: null;
	}
	const expiresAt = Number(row.expires_at ?? 0);
	const now = Date.now();
	const isExpired = Number.isFinite(expiresAt) && expiresAt > 0 && now > expiresAt;
	const staleMaxMs = (options?.staleMaxAgeSeconds ?? 0) * 1000;
	if (isExpired && !options?.allowStale) {
		return null;
	}
	if (isExpired && options?.allowStale && staleMaxMs > 0 && now - expiresAt > staleMaxMs) {
		return { value: null, isStale: true, updatedAt: row.updated_at ?? null, expiresAt: row.expires_at ?? null };
	}
	try {
		const value = JSON.parse(String(row.value_json ?? 'null')) as T;
		if (options?.allowStale) {
			return {
				value,
				isStale: isExpired,
				updatedAt: row.updated_at ?? null,
				expiresAt: row.expires_at ?? null,
			};
		}
		return value;
	} catch (error) {
		console.warn('[tursoCache] Failed to parse cached JSON', error);
		return options?.allowStale
			? { value: null, isStale: false, updatedAt: row.updated_at ?? null, expiresAt: row.expires_at ?? null }
			: null;
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

/** Delete a single cache entry by exact key. */
export async function deleteCache(key: string): Promise<void> {
	await db.execute({
		sql: `DELETE FROM cache WHERE cache_key = ?`,
		args: [key],
	});
}

/**
 * Delete all cache entries whose key starts with `prefix`.
 * Uses a SQL LIKE pattern — safe because we escape `%` and `_` in the prefix.
 * Useful for busting all tenant-scoped keys after a pipeline run:
 *   deleteCachePrefix(`t:${tenantId}:`)
 */
export async function deleteCachePrefix(prefix: string): Promise<void> {
	// Escape LIKE special characters in the prefix itself, then append wildcard
	const escaped = prefix.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
	await db.execute({
		sql: `DELETE FROM cache WHERE cache_key LIKE ? ESCAPE '\\'`,
		args: [`${escaped}%`],
	});
}
