/**
 * The identification record and its Bitcoin timestamp (src/lib/lotIdentificationStore.ts,
 * lotIdentificationStamp.ts, tax/lotIdentificationTree.ts).
 *
 *   - An entry is written with the server's own clock; every entry of one click shares that moment.
 *   - A write that could backdate is refused and stores nothing.
 *   - Nothing here updates or deletes an entry, and every statement is scoped by the tenant.
 *   - A batch is stamped once, on its Merkle root; a calendar that is down leaves it to retry, safely.
 *   - A completed proof gives its Bitcoin block, and the block's time counts only if its Merkle root matches.
 *
 * Invented ids and wallet keys; the database, the calendars and the explorer are stubs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	statements: [] as { sql: string; args: unknown[] }[],
	stampRows: new Map<string, Record<string, unknown>>(),
	entryRows: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/db', () => {
	const execute = vi.fn(async ({ sql, args }: { sql: string; args: unknown[] }) => {
		state.statements.push({ sql, args });
		if (/^\s*SELECT .* FROM lot_identification_stamps WHERE tenant_id = \? AND batch_id = \?/s.test(sql)) {
			const row = state.stampRows.get(String(args[1]));
			return { rows: row && row.tenant_id === args[0] ? [row] : [] };
		}
		if (/^\s*SELECT .* FROM lot_identification_stamps WHERE tenant_id = \?/s.test(sql)) {
			return { rows: [...state.stampRows.values()].filter((r) => r.tenant_id === args[0]) };
		}
		if (/INSERT INTO lot_identification_stamps/.test(sql)) {
			const [batchId, tenantId, ids, root] = args as string[];
			if (!state.stampRows.has(batchId)) {
				state.stampRows.set(batchId, { batch_id: batchId, tenant_id: tenantId, entry_ids_json: ids, root_hex: root, status: 'unstamped', ots_base64: null, calendar: null, block_height: null, block_time: null, attempts: 0, last_attempt_at: null, created_at: 'x' });
			}
			return { rows: [] };
		}
		if (/UPDATE lot_identification_stamps\s+SET status = 'pending'/.test(sql)) {
			const [ots, calendar, at, tenantId, batchId] = args as string[];
			const row = state.stampRows.get(batchId);
			if (row && row.tenant_id === tenantId && row.status === 'unstamped') Object.assign(row, { status: 'pending', ots_base64: ots, calendar, last_attempt_at: at, attempts: Number(row.attempts) + 1 });
			return { rows: [] };
		}
		if (/UPDATE lot_identification_stamps SET attempts = attempts \+ 1/.test(sql)) {
			const [at, tenantId, batchId] = args as string[];
			const row = state.stampRows.get(batchId);
			if (row && row.tenant_id === tenantId && row.status === 'unstamped') Object.assign(row, { last_attempt_at: at, attempts: Number(row.attempts) + 1 });
			return { rows: [] };
		}
		if (/UPDATE lot_identification_stamps\s+SET status = 'confirmed'/.test(sql)) {
			const [ots, height, time, at, tenantId, batchId] = args as [string, number, string | null, string, string, string];
			const row = state.stampRows.get(batchId);
			if (row && row.tenant_id === tenantId) Object.assign(row, { status: 'confirmed', ots_base64: ots, block_height: height, block_time: time, last_attempt_at: at });
			return { rows: [] };
		}
		if (/UPDATE lot_identification_stamps SET last_attempt_at/.test(sql)) {
			const row = state.stampRows.get(String(args[args.length - 1]));
			if (row) row.last_attempt_at = args[0];
			return { rows: [] };
		}
		if (/FROM lot_identifications WHERE tenant_id = \? AND id = \?/.test(sql)) {
			const row = state.entryRows.find((r) => r.tenant_id === args[0] && r.id === args[1]);
			return { rows: row ? [{ wallet_key: row.wallet_key }] : [] };
		}
		if (/FROM lot_identifications WHERE tenant_id = \?/.test(sql)) {
			return { rows: state.entryRows.filter((r) => r.tenant_id === args[0]) };
		}
		return { rows: [] };
	});
	const batch = vi.fn(async (stmts: { sql: string; args: unknown[] }[]) => {
		for (const s of stmts) {
			state.statements.push(s);
			if (/INSERT INTO lot_identifications /.test(s.sql)) {
				const [id, tenant_id, wallet_key, method, effective_at, created_at, note, batch_id, source] = s.args as string[];
				state.entryRows.push({ id, tenant_id, wallet_key, method, effective_at, created_at, note, batch_id, source });
			}
		}
		return [];
	});
	return { db: { execute, batch } };
});

import { confirmWithExchange, createIdentifications, loadIdentifications } from '../../src/lib/lotIdentificationStore';
import { loadStamps, refreshAll, refreshStamps, RETRY_AFTER_MS, stampBatch } from '../../src/lib/lotIdentificationStamp';
import { batchRoot, bitcoinAttestations, entryProofOf, lookupBlockTime } from '../../src/lib/tax/lotIdentificationTree';
import { hashNode, toHex, verifyInclusionProof } from '../../src/lib/recordProof/merkle';
import { buildOtsFile } from '../../src/lib/otsStamp';
import { serializeTimestamp, type TreeNode } from '../../src/lib/otsTree';
import type { LotIdentification } from '../../src/lib/tax/lotIdentification';

const T1 = 'tenant-one';
const T2 = 'tenant-two';
const CEX = 'cex:coinbase:acct-a';
const CHAIN = 'ethereum:0x' + 'a'.repeat(40);
const clock = (iso: string) => () => new Date(iso);

beforeEach(() => {
	state.statements = [];
	state.stampRows.clear();
	state.entryRows = [];
});

describe('recording entries', () => {
	it('stamps every entry of one click with the same server time, and stores the tenant from the caller', async () => {
		const out = await createIdentifications(T1, [{ walletKey: CEX, method: 'earliest' }, { walletKey: CHAIN, method: 'earliest' }], 'apply_all', clock('2025-06-01T10:00:00.000Z'));
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.entries.map((e) => e.createdAt)).toEqual(['2025-06-01T10:00:00.000Z', '2025-06-01T10:00:00.000Z']);
		expect(new Set(out.entries.map((e) => e.batchId)).size).toBe(1);
		expect(state.entryRows.map((r) => r.tenant_id)).toEqual([T1, T1]);
		expect(state.entryRows.map((r) => r.effective_at)).toEqual(['2025-06-01T10:00:00.000Z', '2025-06-01T10:00:00.000Z']);
		expect(state.entryRows.every((r) => r.source === 'apply_all')).toBe(true);
	});

	it('refuses a backdated effective time and stores nothing', async () => {
		const out = await createIdentifications(T1, [{ walletKey: CEX, method: 'latest', effectiveAt: '2025-05-01T00:00:00Z' }], 'manual', clock('2025-06-01T10:00:00.000Z'));
		expect(out).toEqual({ ok: false, error: 'effective_before_recorded' });
		expect(state.entryRows).toEqual([]);
	});

	it('ignores a created-at in the request: the field cannot be set', async () => {
		const out = await createIdentifications(T1, [{ walletKey: CEX, method: 'latest', createdAt: '2020-01-01T00:00:00Z' }], 'manual', clock('2025-06-01T10:00:00.000Z'));
		expect(out.ok && out.entries[0].createdAt).toBe('2025-06-01T10:00:00.000Z');
	});

	it('never issues an UPDATE or DELETE against the entries', async () => {
		await createIdentifications(T1, [{ walletKey: CEX, method: 'latest' }], 'manual');
		await confirmWithExchange(T1, String(state.entryRows[0].id));
		await loadIdentifications(T1);
		expect(state.statements.filter((s) => /(UPDATE|DELETE)\s+(FROM\s+)?lot_identifications\b/i.test(s.sql))).toEqual([]);
	});

	it('reads only the caller\'s tenant', async () => {
		await createIdentifications(T1, [{ walletKey: CEX, method: 'latest' }], 'manual');
		await createIdentifications(T2, [{ walletKey: CHAIN, method: 'highest_basis' }], 'manual');
		expect((await loadIdentifications(T1)).map((e) => e.walletKey)).toEqual([CEX]);
		expect((await loadIdentifications(T2)).map((e) => e.walletKey)).toEqual([CHAIN]);
	});

	it('every statement that touches these tables names the tenant', async () => {
		await createIdentifications(T1, [{ walletKey: CEX, method: 'latest' }], 'manual');
		await loadIdentifications(T1);
		const touching = state.statements.filter((s) => /lot_identification/.test(s.sql) && !/CREATE (TABLE|INDEX)/.test(s.sql));
		expect(touching.length).toBeGreaterThan(0);
		for (const s of touching) expect(s.sql, s.sql).toMatch(/tenant_id/);
	});
});

describe('marking an exchange-held entry confirmed', () => {
	it('works for an exchange account of the same tenant only', async () => {
		await createIdentifications(T1, [{ walletKey: CEX, method: 'latest' }, { walletKey: CHAIN, method: 'latest' }], 'manual');
		const [cex, chain] = state.entryRows;
		expect(await confirmWithExchange(T2, String(cex.id))).toBe(false);
		expect(await confirmWithExchange(T1, String(chain.id))).toBe(false);
		expect(await confirmWithExchange(T1, String(cex.id))).toBe(true);
	});
});

// ── The tree ─────────────────────────────────────────────────────────────────

const mk = (id: string, walletKey: string, over: Partial<LotIdentification> = {}): LotIdentification => ({
	id, walletKey, method: 'earliest', effectiveAt: '2025-06-01T10:00:00.000Z', createdAt: '2025-06-01T10:00:00.000Z', note: null, batchId: 'batch-x', ...over,
});

describe('a batch is one Merkle tree', () => {
	const entries = [mk('e3', CHAIN), mk('e1', CEX), mk('e2', 'ethereum:0x' + 'b'.repeat(40), { note: 'standing order' })];

	it('has one root whatever order the entries come in', () => {
		expect(batchRoot(entries).rootHex).toBe(batchRoot([...entries].reverse()).rootHex);
	});

	it('gives each entry a path that reproduces the root', () => {
		const { rootHex } = batchRoot(entries);
		for (const e of entries) {
			const proof = entryProofOf(entries, e.id, null)!;
			expect(proof.rootHex).toBe(rootHex);
			expect(verifyInclusionProof(Buffer.from(proof.leafHash, 'hex'), proof.inclusion, rootHex)).toBe(true);
		}
		expect(entryProofOf(entries, 'missing', null)).toBeNull();
	});

	it('changes the root if any recorded field changes', () => {
		const changed = entries.map((e) => (e.id === 'e1' ? { ...e, method: 'latest' as const } : e));
		expect(batchRoot(changed).rootHex).not.toBe(batchRoot(entries).rootHex);
	});

	it('is the documented tree: a lone third leaf is promoted, not duplicated', () => {
		const { ordered, leafHashes, rootHex } = batchRoot(entries);
		expect(ordered.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
		expect(rootHex).toBe(toHex(hashNode(hashNode(leafHashes[0], leafHashes[1]), leafHashes[2])));
	});
});

// ── Stamping ─────────────────────────────────────────────────────────────────

const batchEntries = [mk('e1', CEX), mk('e2', CHAIN)];
const fakeOts = Buffer.from('pending-proof');
const okStamp = vi.fn(async (_digest: Buffer, _opts?: unknown) => ({ calendar: 'https://a.pool.opentimestamps.org', ots: fakeOts }));
const downStamp = vi.fn(async (_digest: Buffer, _opts?: unknown): Promise<{ calendar: string; ots: Buffer }> => { throw new Error('down'); });

describe('stamping a batch at creation', () => {
	beforeEach(() => { okStamp.mockClear(); downStamp.mockClear(); });

	it('submits the root once and keeps the pending proof', async () => {
		const row = await stampBatch(T1, batchEntries, { stamp: okStamp, now: clock('2025-06-01T10:00:05.000Z') });
		expect(okStamp).toHaveBeenCalledTimes(1);
		expect(Buffer.from(okStamp.mock.calls[0][0]).toString('hex')).toBe(batchRoot(batchEntries).rootHex);
		expect(row).toMatchObject({ status: 'pending', calendar: 'https://a.pool.opentimestamps.org', attempts: 1 });
		expect(row?.otsBase64).toBe(fakeOts.toString('base64'));
	});

	it('leaves an unstamped batch to retry when no calendar answers, and the entries stay recorded', async () => {
		const row = await stampBatch(T1, batchEntries, { stamp: downStamp, now: clock('2025-06-01T10:00:05.000Z') });
		expect(row).toMatchObject({ status: 'unstamped', otsBase64: null, attempts: 1 });
		expect((await loadStamps(T1)).size).toBe(1);
	});

	it('retries the same root later, and not before the wait is over', async () => {
		await stampBatch(T1, batchEntries, { stamp: downStamp, now: clock('2025-06-01T10:00:05.000Z') });
		const tooSoon = clock(new Date(Date.parse('2025-06-01T10:00:05.000Z') + RETRY_AFTER_MS - 1000).toISOString());
		await refreshStamps(T1, { stamp: okStamp, now: tooSoon });
		expect(okStamp).not.toHaveBeenCalled();
		const later = clock(new Date(Date.parse('2025-06-01T10:00:05.000Z') + RETRY_AFTER_MS + 1000).toISOString());
		const out = await refreshStamps(T1, { stamp: okStamp, now: later });
		expect(okStamp).toHaveBeenCalledTimes(1);
		expect(Buffer.from(okStamp.mock.calls[0][0]).toString('hex')).toBe(batchRoot(batchEntries).rootHex);
		expect([...out.values()][0].status).toBe('pending');
	});

	it('a force refresh skips the wait', async () => {
		await stampBatch(T1, batchEntries, { stamp: downStamp, now: clock('2025-06-01T10:00:05.000Z') });
		await refreshStamps(T1, { stamp: okStamp, now: clock('2025-06-01T10:00:06.000Z'), force: true });
		expect(okStamp).toHaveBeenCalledTimes(1);
	});

	it('does not stamp a second time once pending', async () => {
		await stampBatch(T1, batchEntries, { stamp: okStamp });
		await stampBatch(T1, batchEntries, { stamp: okStamp });
		expect(okStamp).toHaveBeenCalledTimes(1);
	});

	it('registers and stamps a batch whose first attempt died before its row was written', async () => {
		await createIdentifications(T1, [{ walletKey: CEX, method: 'earliest' }], 'manual');
		expect(state.stampRows.size).toBe(0);
		await refreshAll(T1, { stamp: okStamp });
		expect(state.stampRows.size).toBe(1);
		expect(okStamp).toHaveBeenCalledTimes(1);
	});

	it('never lets one tenant see or retry another tenant\'s batch', async () => {
		await stampBatch(T1, batchEntries, { stamp: downStamp });
		expect((await loadStamps(T2)).size).toBe(0);
		await refreshStamps(T2, { stamp: okStamp, force: true });
		expect(okStamp).not.toHaveBeenCalled();
	});
});

describe('confirming the timestamp', () => {
	const root = Buffer.alloc(32, 7);
	const BITCOIN_TAG = Buffer.from('0588960d73d71901', 'hex');
	const proofWithBlock = (height: number): Buffer => {
		const digest = Buffer.alloc(32, 1);
		// 840000 as a little-endian base-128 varuint
		const bytes: number[] = [];
		let v = height;
		do { let b = v & 0x7f; v = Math.floor(v / 128); if (v > 0) b |= 0x80; bytes.push(b); } while (v > 0);
		const node: TreeNode = { msg: digest, attestations: [{ kind: 'other', tag: BITCOIN_TAG, payload: Buffer.from(bytes) }], ops: [] };
		return buildOtsFile(digest, serializeTimestamp(node));
	};

	it('reads the Bitcoin block out of a completed proof, and nothing from a pending one', () => {
		const atts = bitcoinAttestations(proofWithBlock(840_000));
		expect(atts).toHaveLength(1);
		expect(atts[0].height).toBe(840_000);
		const pending: TreeNode = { msg: Buffer.alloc(32, 1), attestations: [{ kind: 'pending', uri: 'https://a.pool.opentimestamps.org' }], ops: [] };
		expect(bitcoinAttestations(buildOtsFile(Buffer.alloc(32, 1), serializeTimestamp(pending)))).toEqual([]);
	});

	const explorer = (merkleRoot: string, timestamp: unknown = 1_700_000_000): typeof fetch =>
		(async (url: string) => {
			if (String(url).includes('/block-height/')) return new Response('0'.repeat(64));
			return new Response(JSON.stringify({ merkle_root: merkleRoot, timestamp }));
		}) as unknown as typeof fetch;

	it('takes the block time only when the block\'s Merkle root is the one in the proof', async () => {
		const att = { height: 1, msg: root };
		const good = Buffer.from(root).reverse().toString('hex');
		expect(await lookupBlockTime(att, explorer(good))).toBe(new Date(1_700_000_000 * 1000).toISOString());
		expect(await lookupBlockTime(att, explorer('00'.repeat(32)))).toBeNull();
		expect(await lookupBlockTime(att, explorer(good, 'soon'))).toBeNull();
		expect(await lookupBlockTime(att, (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBeNull();
	});

	it('moves a pending batch to confirmed with its block height', async () => {
		await stampBatch(T1, batchEntries, { stamp: okStamp, now: clock('2025-06-01T10:00:05.000Z') });
		const done = proofWithBlock(840_000);
		const upgrade = vi.fn(async () => ({ ots: done, upgraded: 1, stillPending: 0 }));
		const out = await refreshStamps(T1, { upgrade, force: true, fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
		const row = [...out.values()][0];
		expect(row).toMatchObject({ status: 'confirmed', blockHeight: 840_000, blockTime: null });
		expect(row.otsBase64).toBe(done.toString('base64'));
	});

	it('keeps a pending batch pending while Bitcoin has not confirmed', async () => {
		await stampBatch(T1, batchEntries, { stamp: okStamp });
		const upgrade = vi.fn(async (ots: Buffer) => ({ ots, upgraded: 0, stillPending: 1 }));
		const out = await refreshStamps(T1, { upgrade, force: true });
		expect([...out.values()][0]).toMatchObject({ status: 'pending', blockHeight: null });
	});
});
