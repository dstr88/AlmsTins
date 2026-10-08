/**
 * In-memory fixed-window rate limiter.
 *
 * Same algorithm as the per-endpoint Maps in /api/verify/check and /api/verify/anchor, in
 * one place, plus a size bound: expired keys are pruned once the map passes `maxKeys`, and
 * if every key is still live the oldest are dropped. An attacker rotating keys can then
 * cost memory only up to the bound, never without limit.
 *
 * Per process, so it resets on every deploy or restart. Use it to blunt bursts, not as a
 * durable quota (see outboundEmailQuota for the durable kind).
 */
import { getClientIp } from './analytics/ip';

export type FixedWindowLimiter = {
	/** Count one hit for `key`. Returns true when the key is now OVER its limit. */
	hit(key: string, now?: number): boolean;
	/** Number of keys currently tracked (for tests and diagnostics). */
	size(): number;
	/** Forget every key. */
	reset(): void;
};

/**
 * The rate-limit bucket for a client IP: an IPv4 address as is, an IPv6 address by its /64
 * prefix. One IPv6 host normally controls a whole /64 and can use a fresh source address
 * per request, so keying on the full address would hand it a fresh budget every time.
 * IPv4-mapped IPv6 (::ffff:a.b.c.d) counts as the IPv4 address. Anything unparseable is
 * used verbatim, so it is still limited by itself.
 */
export function ipBucket(ip: string | null | undefined): string {
	let v = (ip ?? '').trim().toLowerCase();
	if (!v) return 'unknown';
	if (v.startsWith('[') && v.includes(']')) v = v.slice(1, v.indexOf(']'));
	const zone = v.indexOf('%');
	if (zone >= 0) v = v.slice(0, zone);
	if (!v.includes(':')) return v;

	const raw = v;
	// An embedded dotted IPv4 tail becomes the last two hextets.
	if (v.includes('.')) {
		const cut = v.lastIndexOf(':');
		const octets = v.slice(cut + 1).split('.').map((o) => (/^\d{1,3}$/.test(o) ? Number(o) : NaN));
		if (octets.length !== 4 || octets.some((o) => !(o >= 0 && o <= 255))) return raw;
		v = `${v.slice(0, cut + 1)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
	}

	const halves = v.split('::');
	if (halves.length > 2) return raw;
	const head = halves[0] ? halves[0].split(':') : [];
	const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	const groups = halves.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
	if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return raw;
	const n = groups.map((g) => parseInt(g, 16));
	if (n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff) {
		return [n[6] >> 8, n[6] & 0xff, n[7] >> 8, n[7] & 0xff].join('.');
	}
	return `${n.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}

export function createFixedWindowLimiter(opts: { windowMs: number; max: number; maxKeys?: number }): FixedWindowLimiter {
	const { windowMs, max } = opts;
	const maxKeys = opts.maxKeys ?? 10_000;
	const hits = new Map<string, { count: number; resetAt: number }>();

	const prune = (now: number) => {
		for (const [k, e] of hits) {
			if (now >= e.resetAt) hits.delete(k);
		}
		// Still over the bound: drop the oldest windows (Map iterates in insertion order).
		for (const k of hits.keys()) {
			if (hits.size <= maxKeys) break;
			hits.delete(k);
		}
	};

	return {
		hit(key, now = Date.now()) {
			const e = hits.get(key);
			if (!e || now >= e.resetAt) {
				if (e) hits.delete(key);
				hits.set(key, { count: 1, resetAt: now + windowMs });
				if (hits.size > maxKeys) prune(now);
				return 1 > max;
			}
			e.count += 1;
			return e.count > max;
		},
		size: () => hits.size,
		reset: () => hits.clear(),
	};
}

/** The per-client rate-limit key for a request: `ip:` plus the ipBucket of the trusted client IP. */
export function clientIpKey(request: Request): string {
	return `ip:${ipBucket(getClientIp(request))}`;
}
