import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { OTS_HEADER_MAGIC } from '../../src/lib/otsStamp';
import {
	ProofFormatError,
	parseTimestamp,
	pendingNodes,
	serializeTimestamp,
	type TreeNode,
} from '../../src/lib/otsTree';
import { calendarAllowed, upgradeOts } from '../../src/lib/otsUpgrade';

/**
 * The upgrade path. The fixture is a real pending proof from the public calendar (a random digest,
 * stamped on the live calendars and checked by the official `ots info`). Calendars are replaced by
 * fakes here; the real completed proof is checked later with the official verifier.
 */
const FIXTURE = readFileSync(path.resolve(__dirname, '../fixtures/ots/sample-pending.ots'));
const BITCOIN_TAG = Buffer.from('0588960d73d71901', 'hex');
const HEIGHT_1000 = Buffer.from([0xe8, 0x07]); // varuint 1000, little-endian base-128

function ready(msg: Buffer): Buffer {
	const path: TreeNode = {
		msg,
		attestations: [{ kind: 'other', tag: BITCOIN_TAG, payload: HEIGHT_1000 }],
		ops: [],
	};
	return serializeTimestamp(path);
}

function fakeCalendar(answer: (url: string) => { status: number; body?: Buffer }) {
	const seen: string[] = [];
	const fetchImpl = (async (input: RequestInfo | URL) => {
		const url = String(input);
		seen.push(url);
		const out = answer(url);
		return new Response(new Uint8Array(out.body ?? Buffer.alloc(0)), { status: out.status });
	}) as typeof fetch;
	return { fetchImpl, seen };
}

describe('reading and writing a proof gives back the same bytes', () => {
	it('round-trips the live calendar proof exactly', () => {
		const body = FIXTURE.subarray(OTS_HEADER_MAGIC.length + 2 + 32);
		const digest = FIXTURE.subarray(OTS_HEADER_MAGIC.length + 2, OTS_HEADER_MAGIC.length + 2 + 32);
		const tree = parseTimestamp(body, digest);
		expect(serializeTimestamp(tree).equals(body)).toBe(true);
	});

	it('finds the pending attestation and the calendar it names', () => {
		const body = FIXTURE.subarray(OTS_HEADER_MAGIC.length + 2 + 32);
		const digest = FIXTURE.subarray(OTS_HEADER_MAGIC.length + 2, OTS_HEADER_MAGIC.length + 2 + 32);
		const nodes = pendingNodes(parseTimestamp(body, digest));
		expect(nodes.length).toBe(1);
		const pending = nodes[0].attestations.find((a) => a.kind === 'pending');
		expect(pending).toEqual({ kind: 'pending', uri: 'https://alice.btc.calendar.opentimestamps.org' });
	});
});

describe('which calendars may be called', () => {
	it('allows the OpenTimestamps calendars over https', () => {
		expect(calendarAllowed('https://alice.btc.calendar.opentimestamps.org')).toBe(true);
		expect(calendarAllowed('https://a.pool.opentimestamps.org')).toBe(true);
	});

	it('refuses any other host, plain http, ports, and look-alike domains', () => {
		expect(calendarAllowed('https://evil.example')).toBe(false);
		expect(calendarAllowed('http://alice.btc.calendar.opentimestamps.org')).toBe(false);
		expect(calendarAllowed('https://alice.btc.calendar.opentimestamps.org.evil.example')).toBe(false);
		expect(calendarAllowed('https://alice.btc.calendar.opentimestamps.org:8443')).toBe(false);
		expect(calendarAllowed('https://user@alice.btc.calendar.opentimestamps.org')).toBe(false);
		expect(calendarAllowed('not a url')).toBe(false);
	});
});

describe('upgrading', () => {
	it('keeps the proof unchanged while the calendar says it is not ready', async () => {
		const calendar = fakeCalendar(() => ({ status: 404 }));
		const result = await upgradeOts(FIXTURE, { fetchImpl: calendar.fetchImpl });
		expect(result.upgraded).toBe(0);
		expect(result.stillPending).toBe(1);
		expect(result.ots.equals(FIXTURE)).toBe(true);
		expect(calendar.seen[0]).toMatch(/^https:\/\/alice\.btc\.calendar\.opentimestamps\.org\/timestamp\/[0-9a-f]+$/);
	});

	it('merges the completed path in, replacing the pending attestation', async () => {
		const body = FIXTURE.subarray(OTS_HEADER_MAGIC.length + 2 + 32);
		const digest = FIXTURE.subarray(OTS_HEADER_MAGIC.length + 2, OTS_HEADER_MAGIC.length + 2 + 32);
		const msg = pendingNodes(parseTimestamp(body, digest))[0].msg;
		const calendar = fakeCalendar(() => ({ status: 200, body: ready(msg) }));

		const result = await upgradeOts(FIXTURE, { fetchImpl: calendar.fetchImpl });
		expect(result.upgraded).toBe(1);
		expect(result.stillPending).toBe(0);
		expect(result.ots.equals(FIXTURE)).toBe(false);

		const upgraded = parseTimestamp(result.ots.subarray(OTS_HEADER_MAGIC.length + 2 + 32), digest);
		expect(pendingNodes(upgraded)).toEqual([]);
		expect(result.ots.includes(BITCOIN_TAG)).toBe(true);
		expect(upgraded.attestations.length + upgraded.ops.length).toBeGreaterThan(0);
	});

	it('never calls a host outside the OpenTimestamps domain', async () => {
		const body = FIXTURE.subarray(OTS_HEADER_MAGIC.length + 2 + 32);
		const digest = FIXTURE.subarray(OTS_HEADER_MAGIC.length + 2, OTS_HEADER_MAGIC.length + 2 + 32);
		const tree = parseTimestamp(body, digest);
		const redirect = (node: TreeNode): void => {
			node.attestations = node.attestations.map((a) =>
				a.kind === 'pending' ? { kind: 'pending', uri: 'https://evil.example' } : a,
			);
			node.ops.forEach((op) => redirect(op.child));
		};
		redirect(tree);
		const hostile = serializeTimestamp(tree);
		const proof = Buffer.concat([FIXTURE.subarray(0, OTS_HEADER_MAGIC.length + 2 + 32), hostile]);
		const calendar = fakeCalendar(() => ({ status: 200, body: Buffer.alloc(0) }));
		await upgradeOts(proof, { fetchImpl: calendar.fetchImpl });
		expect(calendar.seen).toEqual([]);
	});

	it('refuses something that is not a proof', async () => {
		const notAProof = Buffer.from('hello world, this is not a timestamp at all, just text');
		await expect(upgradeOts(notAProof, { fetchImpl: fakeCalendar(() => ({ status: 404 })).fetchImpl })).rejects.toBeInstanceOf(
			ProofFormatError,
		);
	});
});
