// Record-set Merkle commitments: the root over an ordered list of records, and inclusion
// proofs for one record in it. Moved out of proof.ts, which is server-only because it signs
// (it imports signing.ts, which reads the private seed). This module is isomorphic: it imports
// only the domain-separated Merkle tree and the canonical-bytes helper, so a page or an offline
// verifier can check a record set without the signer. proof.ts re-exports all three functions.
//
// A leaf is sha256(0x00 || canonical JSON of the record); see recordProof/merkle.ts.

import {
  hashLeaf,
  buildMerkleRoot,
  buildInclusionProof,
  verifyInclusionProof,
  toHex,
  type Hex,
  type InclusionProof,
} from '@/lib/recordProof/merkle';
import { canonicalBytes } from '@/lib/recordProof/isoSign';

/** Canonical bytes of a record → domain-separated Merkle leaf hash. */
function leafHashOf(record: unknown): Uint8Array {
  return hashLeaf(canonicalBytes(record));
}

/** Merkle root (hex) over an ordered record set. The order is part of the commitment. */
export function recordSetRoot(records: unknown[]): Hex {
  return toHex(buildMerkleRoot(records.map(leafHashOf)));
}

/** Inclusion proof that `records[index]` is committed under the set's root. */
export function proveRecordInclusion(records: unknown[], index: number): InclusionProof {
  return buildInclusionProof(records.map(leafHashOf), index);
}

/** Verify one record is in the set committed by `merkleRoot`. Any changed field breaks this. */
export function verifyRecordInclusion(record: unknown, proof: InclusionProof, merkleRoot: Hex): boolean {
  return verifyInclusionProof(leafHashOf(record), proof, merkleRoot);
}
