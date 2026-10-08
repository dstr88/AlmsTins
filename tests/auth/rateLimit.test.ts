import { describe, it, expect } from 'vitest';
import { createFixedWindowLimiter, ipBucket, clientIpKey } from '../../src/lib/rateLimit';

describe('createFixedWindowLimiter', () => {
	it('allows `max` hits per window, then limits', () => {
		const l = createFixedWindowLimiter({ windowMs: 60_000, max: 5 });
		const t = 1_000_000;
		for (let i = 0; i < 5; i++) expect(l.hit('ip:1', t + i)).toBe(false);
		expect(l.hit('ip:1', t + 10)).toBe(true);
		expect(l.hit('ip:1', t + 20)).toBe(true);
	});

	it('keys are independent', () => {
		const l = createFixedWindowLimiter({ windowMs: 60_000, max: 1 });
		expect(l.hit('a', 0)).toBe(false);
		expect(l.hit('a', 1)).toBe(true);
		expect(l.hit('b', 1)).toBe(false);
	});

	it('a new window re-allows', () => {
		const l = createFixedWindowLimiter({ windowMs: 60_000, max: 2 });
		expect(l.hit('k', 0)).toBe(false);
		expect(l.hit('k', 1)).toBe(false);
		expect(l.hit('k', 2)).toBe(true);
		expect(l.hit('k', 60_000)).toBe(false);
		expect(l.hit('k', 60_001)).toBe(false);
		expect(l.hit('k', 60_002)).toBe(true);
	});

	it('keeps at most maxKeys keys under key rotation', () => {
		const l = createFixedWindowLimiter({ windowMs: 60_000, max: 5, maxKeys: 100 });
		for (let i = 0; i < 1_000; i++) l.hit(`ip:${i}`, i);
		expect(l.size()).toBeLessThanOrEqual(100);
	});

	it('prunes expired keys first', () => {
		const l = createFixedWindowLimiter({ windowMs: 10, max: 1, maxKeys: 3 });
		l.hit('old1', 0);
		l.hit('old2', 0);
		l.hit('live', 100);
		l.hit('new', 100);
		expect(l.size()).toBe(2);
		// 'live' kept its window: a second hit is limited.
		expect(l.hit('live', 101)).toBe(true);
	});

	it('reset forgets everything', () => {
		const l = createFixedWindowLimiter({ windowMs: 60_000, max: 1 });
		l.hit('k', 0);
		expect(l.hit('k', 1)).toBe(true);
		l.reset();
		expect(l.hit('k', 2)).toBe(false);
	});
});

describe('ipBucket / clientIpKey (IPv6 by its /64)', () => {
	it('keeps IPv4 as is and folds an IPv4-mapped IPv6 address to it', () => {
		expect(ipBucket('203.0.113.7')).toBe('203.0.113.7');
		expect(ipBucket('::ffff:203.0.113.7')).toBe('203.0.113.7');
		expect(ipBucket('::FFFF:cb00:7107')).toBe('203.0.113.7');
	});

	it('keys every address in one /64 the same, whatever the notation', () => {
		const a = ipBucket('2001:db8:1234:5678:aaaa:bbbb:cccc:dddd');
		expect(a).toBe('2001:db8:1234:5678::/64');
		expect(ipBucket('2001:0DB8:1234:5678::1')).toBe(a);
		expect(ipBucket('[2001:db8:1234:5678::2]')).toBe(a);
		expect(ipBucket('2001:db8:1234:5678::3%eth0')).toBe(a);
		expect(ipBucket('2001:db8:1234:5679::1')).not.toBe(a);
		expect(ipBucket('::1')).toBe('0:0:0:0::/64');
	});

	it('uses anything unparseable verbatim, and "unknown" for nothing', () => {
		expect(ipBucket('not-an-ip')).toBe('not-an-ip');
		expect(ipBucket('1:2:3')).toBe('1:2:3');
		expect(ipBucket(null)).toBe('unknown');
		expect(ipBucket('  ')).toBe('unknown');
	});

	it('clientIpKey reads the Cloudflare header', () => {
		const r = new Request('https://almstins.com/', { headers: { 'cf-connecting-ip': '2001:db8:1:2:3:4:5:6' } });
		expect(clientIpKey(r)).toBe('ip:2001:db8:1:2::/64');
	});
});
