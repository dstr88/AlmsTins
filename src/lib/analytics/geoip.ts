import { db } from '@/lib/db';

export type GeoLookupResult = {
	countryCode: string;
	cacheHit: boolean;
};

function normalizeCountryCode(value: unknown): string {
	if (typeof value !== 'string') return '??';
	const trimmed = value.trim().toUpperCase();
	return /^[A-Z]{2}$/.test(trimmed) ? trimmed : '??';
}

function isFresh(updatedAt: string, maxAgeMs: number) {
	const time = Date.parse(updatedAt);
	if (!Number.isFinite(time)) return false;
	return Date.now() - time <= maxAgeMs;
}

export async function getCountryForIpHash(ipHash: string, ipRaw: string | null): Promise<GeoLookupResult> {
	const nowIso = new Date().toISOString();
	const maxAgeMs = 24 * 60 * 60 * 1000;

	try {
		const cached = await db.execute({
			sql: 'SELECT country_code, updated_at FROM ip_geo_cache WHERE ip_hash = ? LIMIT 1',
			args: [ipHash],
		});
		const row = cached.rows[0] as Record<string, unknown> | undefined;
		const cachedUpdatedAt = typeof row?.updated_at === 'string' ? row.updated_at : null;
		if (row && cachedUpdatedAt && isFresh(cachedUpdatedAt, maxAgeMs)) {
			return {
				countryCode: normalizeCountryCode(row.country_code),
				cacheHit: true,
			};
		}
	} catch (error) {
		console.warn('[analytics] ip_geo_cache read failed', error instanceof Error ? error.message : String(error));
	}

	if (!ipRaw) {
		return { countryCode: '??', cacheHit: false };
	}

	const token = process.env.IPINFO_TOKEN;
	if (!token) {
		return { countryCode: '??', cacheHit: false };
	}

	let countryCode = '??';
	try {
		const endpoint = `https://api.ipinfo.io/lite/${encodeURIComponent(ipRaw)}?token=${encodeURIComponent(token)}`;
		const response = await fetch(endpoint);
		if (response.ok) {
			const data = (await response.json()) as Record<string, unknown>;
			countryCode = normalizeCountryCode(data.country_code ?? data.country);
		}
	} catch (error) {
		console.warn('[analytics] geoip lookup failed', error instanceof Error ? error.message : String(error));
	}

	try {
		await db.execute({
			sql: `
				INSERT INTO ip_geo_cache (ip_hash, country_code, updated_at)
				VALUES (?, ?, ?)
				ON CONFLICT(ip_hash) DO UPDATE SET
					country_code = excluded.country_code,
					updated_at = excluded.updated_at
			`,
			args: [ipHash, countryCode, nowIso],
		});
	} catch (error) {
		console.warn('[analytics] ip_geo_cache write failed', error instanceof Error ? error.message : String(error));
	}

	return { countryCode, cacheHit: false };
}

