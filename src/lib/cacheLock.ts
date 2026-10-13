import { db } from '@/lib/db';

/**
 * A simple distributed-ish lock using the same Turso DB.
 * Prevents dogpiling: only one request refreshes per lock window.
 *
 * Returns true if lock acquired, false if someone else holds it.
 */
export async function tryAcquireLock(lockKey: string, ttlSeconds: number): Promise<boolean> {
	const now = Date.now();
	const expiresAt = now + ttlSeconds * 1000;

	try {
		// Insert the lock if absent. If present, we don't overwrite here.
		await db.execute({
			sql: `INSERT INTO cache (cache_key, value_json, expires_at, updated_at)
			      VALUES (?, ?, ?, ?)
			      ON CONFLICT(cache_key) DO NOTHING`,
			args: [lockKey, JSON.stringify({ lock: true }), expiresAt, now],
		});

		// Check if we are the owner (i.e., lock isn't expired and exists)
		const res = await db.execute({
			sql: `SELECT expires_at FROM cache WHERE cache_key = ? LIMIT 1`,
			args: [lockKey],
		});
		const row = res.rows?.[0] as { expires_at?: number } | undefined;
		const exp = Number(row?.expires_at ?? 0);

		if (exp > now) {
			return true;
		}

		// Expired lock: steal it.
		await db.execute({
			sql: `UPDATE cache SET value_json = ?, expires_at = ?, updated_at = ?
			      WHERE cache_key = ? AND (expires_at IS NULL OR expires_at <= ?)`,
			args: [JSON.stringify({ lock: true }), expiresAt, now, lockKey, now],
		});

		return true;
	} catch {
		return false;
	}
}
