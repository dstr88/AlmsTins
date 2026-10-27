import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
	CALENDARS,
	CalendarUnavailableError,
	OTS_HEADER_MAGIC,
	buildOtsFile,
	stampDigest,
	submitDigest,
} from '../../src/lib/otsStamp';

/**
 * The OpenTimestamps stamp, without a package. The header bytes are the official client's constant
 * (python-opentimestamps core/timestamp.py HEADER_MAGIC). The network is replaced by a fake: the
 * real calendars are checked by the official verifier, not by these tests.
 */
const digest = createHash('sha256').update('year-end report, test root').digest();
const calendarTimestamp = Buffer.from([0xf0, 0x01, 0xaa, 0x00, 0x83]); // a stand-in body for the layout checks

function fakeFetch(handler: (url: string) => { status?: number; body?: Buffer } | 'throw'): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const out = handler(url);
		if (out === 'throw') throw new Error('network down');
		const body = out.body ?? Buffer.alloc(0);
		expect(init?.method).toBe('POST');
		return new Response(new Uint8Array(body), { status: out.status ?? 200 });
	}) as typeof fetch;
}

describe('the file header is the official one', () => {
	it('is the 31-byte magic from the official client', () => {
		expect(OTS_HEADER_MAGIC.length).toBe(31);
		expect(OTS_HEADER_MAGIC.toString('hex')).toBe('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294');
	});

	it('lays out magic, version 1, SHA-256 operation, digest, then the calendar timestamp', () => {
		const file = buildOtsFile(digest, calendarTimestamp);
		expect(file.subarray(0, 31).equals(OTS_HEADER_MAGIC)).toBe(true);
		expect(file[31]).toBe(0x01);
		expect(file[32]).toBe(0x08);
		expect(file.subarray(33, 65).equals(digest)).toBe(true);
		expect(file.subarray(65).equals(calendarTimestamp)).toBe(true);
	});

	it('refuses anything that is not a 32-byte SHA-256 digest', () => {
		expect(() => buildOtsFile(Buffer.alloc(31), calendarTimestamp)).toThrow(/32-byte/);
		expect(() => buildOtsFile(Buffer.alloc(33), calendarTimestamp)).toThrow(/32-byte/);
	});
});

describe('submitting the digest', () => {
	it('posts the raw digest to /digest and returns the calendar timestamp', async () => {
		const seen: string[] = [];
		const out = await submitDigest(
			digest,
			'https://calendar.test',
			fakeFetch((url) => {
				seen.push(url);
				return { body: calendarTimestamp };
			}),
		);
		expect(seen).toEqual(['https://calendar.test/digest']);
		expect(out.equals(calendarTimestamp)).toBe(true);
	});

	it('throws when the calendar does not answer 200', async () => {
		await expect(
			submitDigest(digest, 'https://calendar.test', fakeFetch(() => ({ status: 500 }))),
		).rejects.toThrow(/answered 500/);
	});
});

describe('stamping falls back between calendars', () => {
	it('uses the official public calendars by default', () => {
		expect([...CALENDARS]).toEqual(['https://a.pool.opentimestamps.org', 'https://b.pool.opentimestamps.org']);
	});

	it('moves to the second calendar when the first fails', async () => {
		const result = await stampDigest(digest, {
			calendars: ['https://one.test', 'https://two.test'],
			fetchImpl: fakeFetch((url) => (url.startsWith('https://one') ? 'throw' : { body: calendarTimestamp })),
		});
		expect(result.calendar).toBe('https://two.test');
		expect(result.ots.subarray(65).equals(calendarTimestamp)).toBe(true);
	});

	it('throws a clear error when no calendar answers, so the stamp stays pending', async () => {
		await expect(
			stampDigest(digest, {
				calendars: ['https://one.test'],
				fetchImpl: fakeFetch(() => 'throw'),
			}),
		).rejects.toBeInstanceOf(CalendarUnavailableError);
	});

	it('treats an empty answer as no answer', async () => {
		await expect(
			stampDigest(digest, {
				calendars: ['https://one.test'],
				fetchImpl: fakeFetch(() => ({ body: Buffer.alloc(0) })),
			}),
		).rejects.toBeInstanceOf(CalendarUnavailableError);
	});
});
