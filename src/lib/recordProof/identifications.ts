// The lot identifications that travel with a signed Year-Summary record. Pure: no database, no clock.
//
// The record's manifest (signed) carries `identifications_root`, a Merkle root over one reference per
// identification recorded up to the end of the year, and `identification_count`. The bundle carries
// the references and the Bitcoin timestamp of each batch, so the dated record leaves with the figures.
//
// PII-FREE, like the leaves: a reference holds an opaque wallet tag (not the wallet key or address) and
// no note. It also holds the entry's leaf hash in its batch tree, so with the entry file the owner can
// download from the identifications page (which has the wallet key and note), anyone can recompute
// that hash, check its inclusion path to the batch root, and verify the .ots proof of the root with an
// OpenTimestamps client. What a timestamp shows is that the entry existed unchanged no later than the
// time of the Bitcoin block, nothing more.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import canonicalize from 'canonicalize';
import { buildInclusionProof, buildMerkleRoot, hashLeaf, toHex, type Hex, type InclusionProof } from './merkle';
import { batchRoot } from '../tax/lotIdentificationTree';
import type { StampRow } from '../lotIdentificationStamp';
import type { LotIdentification } from '../tax/lotIdentification';

export const IDENTIFICATION_REF_VERSION = 1;

/** What a year's export carries about identifications, before it is turned into references. */
export interface YearIdentifications {
	/** Entries recorded up to the end of the year, oldest first. */
	entries: LotIdentification[];
	stamps: StampRow[];
	/** Sales of the year covered by an identification recorded before them, and all sales of the year. */
	covered: number;
	total: number;
}

export interface IdentificationRef {
	id: string;
	/** Opaque and stable per tenant and wallet; not the wallet key. */
	wallet_tag: string;
	method: string;
	effective_at: string;
	created_at: string;
	batch_id: string;
	/** The entry's leaf in its batch tree (needs the entry file to recompute). */
	entry_leaf_hash: Hex;
	inclusion: InclusionProof;
}

export interface IdentificationBatchProof {
	batch_id: string;
	batch_root: Hex;
	status: string;
	block_height: number | null;
	block_time: string | null;
	/** The pending or completed OpenTimestamps proof of batch_root, base64. */
	ots_base64: string | null;
}

export interface BundleIdentifications {
	ref_version: number;
	refs: IdentificationRef[];
	batches: IdentificationBatchProof[];
	covered_sales: number;
	total_sales: number;
}

export function walletTag(tenantId: string, walletKey: string): string {
	return 'wt-' + bytesToHex(sha256(utf8ToBytes(`almstins-identification-wallet-tag:${tenantId}:${walletKey}`))).slice(0, 24);
}

function refBytes(r: Omit<IdentificationRef, 'inclusion'>): Uint8Array {
	const json = canonicalize({ v: IDENTIFICATION_REF_VERSION, kind: 'lot_identification_ref', ...r });
	if (json === undefined) throw new Error('identification ref: canonicalize returned undefined');
	return utf8ToBytes(json);
}

const refOrder = (a: { created_at: string; id: string }, b: { created_at: string; id: string }): number =>
	a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * References, batch proofs and the root the manifest signs. Null when there are no entries (the
 * manifest then carries no identification fields, exactly as records made before this existed).
 */
export function buildIdentificationSection(
	tenantId: string,
	data: YearIdentifications,
): { section: BundleIdentifications; root: Hex; count: number } | null {
	if (data.entries.length === 0) return null;

	const byBatch = new Map<string, LotIdentification[]>();
	for (const e of data.entries) {
		const list = byBatch.get(e.batchId);
		if (list) list.push(e);
		else byBatch.set(e.batchId, [e]);
	}
	const stampOf = new Map(data.stamps.map((s) => [s.batchId, s]));

	const refs: IdentificationRef[] = [];
	const batches: IdentificationBatchProof[] = [];
	for (const [batchId, members] of byBatch) {
		const { rootHex, ordered, leafHashes } = batchRoot(members);
		const stamp = stampOf.get(batchId) ?? null;
		batches.push({
			batch_id: batchId,
			batch_root: rootHex,
			status: stamp?.status ?? 'unstamped',
			block_height: stamp?.blockHeight ?? null,
			block_time: stamp?.blockTime ?? null,
			ots_base64: stamp?.otsBase64 ?? null,
		});
		ordered.forEach((e, i) => {
			refs.push({
				id: e.id,
				wallet_tag: walletTag(tenantId, e.walletKey),
				method: e.method,
				effective_at: e.effectiveAt,
				created_at: e.createdAt,
				batch_id: batchId,
				entry_leaf_hash: toHex(leafHashes[i]),
				inclusion: buildInclusionProof(leafHashes, i),
			});
		});
	}
	refs.sort(refOrder);
	batches.sort((a, b) => (a.batch_id < b.batch_id ? -1 : 1));

	const leafHashes = refs.map(({ inclusion: _i, ...r }) => hashLeaf(refBytes(r)));
	return {
		section: { ref_version: IDENTIFICATION_REF_VERSION, refs, batches, covered_sales: data.covered, total_sales: data.total },
		root: toHex(buildMerkleRoot(leafHashes)),
		count: refs.length,
	};
}
