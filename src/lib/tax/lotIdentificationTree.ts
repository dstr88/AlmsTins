/**
 * lotIdentificationTree.ts: the pure half of the Bitcoin timestamp for lot identifications. No database.
 *
 * One batch of entries is one Merkle tree (recordProof/merkle.ts). An entry's leaf is its canonical
 * record; its inclusion path and the batch root come from here, and so does reading the Bitcoin
 * attestation out of a completed OpenTimestamps proof and checking the block's time against it.
 */

import canonicalize from 'canonicalize';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { buildInclusionProof, buildMerkleRoot, hashLeaf, toHex, verifyInclusionProof, type InclusionProof } from '../recordProof/merkle';
import { OTS_HEADER_MAGIC, SHA256_DIGEST_LENGTH } from '../otsStamp';
import { parseTimestamp, type TreeNode } from '../otsTree';
import type { LotIdentification } from './lotIdentification';

export type StampStatus = 'unstamped' | 'pending' | 'confirmed';

/** The part of a stored stamp the proof needs. */
export interface StampInfo {
	status: StampStatus;
	otsBase64: string | null;
	blockHeight: number | null;
	blockTime: string | null;
}

// ── The tree (pure) ──────────────────────────────────────────────────────────

/** The bytes one entry contributes to its batch's tree. Everything that makes the record, nothing that can change. */
export function entryLeafBytes(e: LotIdentification): Uint8Array {
	const json = canonicalize({
		v: 1,
		kind: 'lot_identification',
		id: e.id,
		wallet_key: e.walletKey,
		method: e.method,
		effective_at: e.effectiveAt,
		created_at: e.createdAt,
		note: e.note,
		batch_id: e.batchId,
	});
	if (json === undefined) throw new Error('lot identification: canonicalize returned undefined');
	return utf8ToBytes(json);
}

export const orderBatch = (entries: readonly LotIdentification[]): LotIdentification[] =>
	[...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function batchRoot(entries: readonly LotIdentification[]): { rootHex: string; ordered: LotIdentification[]; leafHashes: Uint8Array[] } {
	const ordered = orderBatch(entries);
	const leafHashes = ordered.map((e) => hashLeaf(entryLeafBytes(e)));
	return { rootHex: toHex(buildMerkleRoot(leafHashes)), ordered, leafHashes };
}

export interface EntryProof {
	entry: LotIdentification;
	leafHash: string;
	inclusion: InclusionProof;
	rootHex: string;
	/** The .ots file for the root, as base64; null until a calendar has accepted it. */
	otsBase64: string | null;
	status: StampStatus;
	blockHeight: number | null;
	blockTime: string | null;
}

/** The proof for one entry of a batch: its inclusion path to the stamped root, and the stamp. Null when the entry is not in the batch. */
export function entryProofOf(entries: readonly LotIdentification[], id: string, stamp: StampInfo | null): EntryProof | null {
	const { rootHex, ordered, leafHashes } = batchRoot(entries);
	const index = ordered.findIndex((e) => e.id === id);
	if (index < 0) return null;
	const inclusion = buildInclusionProof(leafHashes, index);
	if (!verifyInclusionProof(leafHashes[index], inclusion, rootHex)) return null;
	return {
		entry: ordered[index],
		leafHash: toHex(leafHashes[index]),
		inclusion,
		rootHex,
		otsBase64: stamp?.otsBase64 ?? null,
		status: stamp?.status ?? 'unstamped',
		blockHeight: stamp?.blockHeight ?? null,
		blockTime: stamp?.blockTime ?? null,
	};
}

// ── Reading the proof (pure) ─────────────────────────────────────────────────

/** The attestation tag of a Bitcoin block header (python-opentimestamps core/notary.py). */
const BITCOIN_TAG = Buffer.from('0588960d73d71901', 'hex');

function readVaruint(buf: Buffer): number | null {
	let value = 0;
	let shift = 0;
	for (let i = 0; i < buf.length; i++) {
		value += (buf[i] & 0x7f) * 2 ** shift;
		if (!Number.isSafeInteger(value)) return null;
		if ((buf[i] & 0x80) === 0) return value;
		shift += 7;
		if (shift > 56) return null;
	}
	return null;
}

export interface BitcoinAttestation {
	height: number;
	/** The message the attestation commits to: the block's Merkle root, in internal (little-endian) byte order. */
	msg: Buffer;
}

/** Every Bitcoin attestation in an .ots file, smallest height first. Empty while the proof is only pending. */
export function bitcoinAttestations(ots: Buffer): BitcoinAttestation[] {
	const headLen = OTS_HEADER_MAGIC.length + 2 + SHA256_DIGEST_LENGTH;
	if (ots.length <= headLen) return [];
	const digest = Buffer.from(ots.subarray(OTS_HEADER_MAGIC.length + 2, headLen));
	const root = parseTimestamp(ots.subarray(headLen), digest);
	const out: BitcoinAttestation[] = [];
	const walk = (node: TreeNode, depth: number): void => {
		if (depth > 300) return;
		for (const a of node.attestations) {
			if (a.kind === 'other' && a.tag.equals(BITCOIN_TAG)) {
				const height = readVaruint(a.payload);
				if (height !== null) out.push({ height, msg: node.msg });
			}
		}
		for (const op of node.ops) walk(op.child, depth + 1);
	};
	walk(root, 0);
	return out.sort((a, b) => a.height - b.height);
}

// ── Block time ───────────────────────────────────────────────────────────────

const EXPLORER = 'https://blockstream.info/api';
const EXPLORER_TIMEOUT_MS = 15_000;

/**
 * The time of the block at `height`, only if the block's Merkle root is the one the proof commits to.
 * Null when the explorer cannot be reached or disagrees; the stamp then stays confirmed without a time
 * and is looked up again later.
 */
export async function lookupBlockTime(att: BitcoinAttestation, fetchImpl: typeof fetch = fetch): Promise<string | null> {
	try {
		const hashRes = await fetchImpl(`${EXPLORER}/block-height/${att.height}`, { signal: AbortSignal.timeout(EXPLORER_TIMEOUT_MS) });
		if (!hashRes.ok) return null;
		const hash = (await hashRes.text()).trim();
		if (!/^[0-9a-f]{64}$/.test(hash)) return null;
		const blockRes = await fetchImpl(`${EXPLORER}/block/${hash}`, { signal: AbortSignal.timeout(EXPLORER_TIMEOUT_MS) });
		if (!blockRes.ok) return null;
		const block = (await blockRes.json()) as { merkle_root?: unknown; timestamp?: unknown };
		const expected = Buffer.from(att.msg).reverse().toString('hex');
		if (typeof block.merkle_root !== 'string' || block.merkle_root.toLowerCase() !== expected) return null;
		if (typeof block.timestamp !== 'number' || !Number.isFinite(block.timestamp)) return null;
		return new Date(block.timestamp * 1000).toISOString();
	} catch {
		return null;
	}
}

