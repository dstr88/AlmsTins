/**
 * Stage 1 of the Bitcoin stamp: send a root hash to OpenTimestamps calendar servers and keep the
 * pending proof as an .ots file. No package and no key: the calendars batch the hash into a Bitcoin
 * transaction, and the proof is completed later (stage 2, not here).
 *
 * The format follows the official client (opentimestamps/python-opentimestamps, core/timestamp.py
 * and core/op.py): header magic, major version 1, the file hash operation (SHA-256, tag 0x08), the
 * digest, then the calendar's timestamp, which is exactly what POST /digest returns. The calendar
 * list is the one the official client ships with.
 */

/** b'\x00OpenTimestamps\x00\x00Proof\x00\xbf\x89\xe2\xe8\x84\xe8\x92\x94' (31 bytes). */
export const OTS_HEADER_MAGIC = Buffer.concat([
	Buffer.from([0x00]),
	Buffer.from('OpenTimestamps'),
	Buffer.from([0x00, 0x00]),
	Buffer.from('Proof'),
	Buffer.from([0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94]),
]);
export const OTS_MAJOR_VERSION = 1;
export const SHA256_OP_TAG = 0x08;
export const SHA256_DIGEST_LENGTH = 32;

export const CALENDARS = ['https://a.pool.opentimestamps.org', 'https://b.pool.opentimestamps.org'] as const;

const SUBMIT_TIMEOUT_MS = 20_000;

export class CalendarUnavailableError extends Error {
	constructor() {
		super('No OpenTimestamps calendar accepted the hash. The stamp stays pending and will be retried.');
		this.name = 'CalendarUnavailableError';
	}
}

/** The .ots bytes for a digest and the calendar's timestamp for it. */
export function buildOtsFile(digest: Buffer, calendarTimestamp: Buffer): Buffer {
	if (digest.length !== SHA256_DIGEST_LENGTH) throw new Error('The digest must be a 32-byte SHA-256 hash.');
	return Buffer.concat([OTS_HEADER_MAGIC, Buffer.from([OTS_MAJOR_VERSION, SHA256_OP_TAG]), digest, calendarTimestamp]);
}

/** Posts the digest to one calendar and returns its timestamp bytes. Throws if it does not answer 200. */
export async function submitDigest(
	digest: Buffer,
	calendar: string,
	fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
	if (digest.length !== SHA256_DIGEST_LENGTH) throw new Error('The digest must be a 32-byte SHA-256 hash.');
	const res = await fetchImpl(`${calendar}/digest`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/octet-stream' },
		body: new Uint8Array(digest),
		signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`${calendar} answered ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

/** Tries each calendar in turn; returns the first pending .ots file. */
export async function stampDigest(
	digest: Buffer,
	opts: { calendars?: readonly string[]; fetchImpl?: typeof fetch } = {},
): Promise<{ calendar: string; ots: Buffer }> {
	for (const calendar of opts.calendars ?? CALENDARS) {
		try {
			const timestamp = await submitDigest(digest, calendar, opts.fetchImpl);
			if (timestamp.length === 0) continue;
			return { calendar, ots: buildOtsFile(digest, timestamp) };
		} catch {
			// Try the next calendar.
		}
	}
	throw new CalendarUnavailableError();
}
