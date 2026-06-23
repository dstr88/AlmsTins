// Domain-separated SHA-256 Merkle tree for verifiable record proofs.
//
//   leaf  = sha256(0x00 || leafBytes)
//   node  = sha256(0x01 || left || right)
//
// The distinct domain prefixes + odd-node PROMOTION (a lone node at any level is
// carried up unchanged, never duplicated) close the classic second-preimage /
// CVE-2012-2459 ambiguities (a node hash can never be reinterpreted as a leaf,
// and there's no Bitcoin-style duplication malleability).
//
// Pure + isomorphic: identical results in Node, the browser, and the offline
// verifier script. Callers pass an ALREADY-ORDERED leaf array (see leaf.ts
// orderLeaves); the tree is a pure function of that order.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils.js';

export type Hex = string; // lowercase hex, no 0x prefix

const LEAF_PREFIX = Uint8Array.of(0x00);
const NODE_PREFIX = Uint8Array.of(0x01);

export function hashLeaf(leafBytes: Uint8Array): Uint8Array {
  return sha256(concatBytes(LEAF_PREFIX, leafBytes));
}

export function hashNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concatBytes(NODE_PREFIX, left, right));
}

export function toHex(b: Uint8Array): Hex {
  return bytesToHex(b);
}
export function fromHex(h: Hex): Uint8Array {
  return hexToBytes(h);
}

/** Advance one Merkle level: pair + hashNode, promoting a lone trailing node. */
function nextLevel(level: Uint8Array[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < level.length; i += 2) {
    if (i + 1 < level.length) out.push(hashNode(level[i], level[i + 1]));
    else out.push(level[i]); // odd node promoted unchanged (no duplication)
  }
  return out;
}

/**
 * Root of an array of ALREADY-HASHED leaves (each = hashLeaf(serializeLeaf(...))).
 * Empty input → a documented sentinel (hashLeaf of empty bytes) so the builder
 * and verifier agree on the degenerate case.
 */
export function buildMerkleRoot(leafHashes: Uint8Array[]): Uint8Array {
  if (leafHashes.length === 0) return hashLeaf(new Uint8Array(0));
  let level = leafHashes.slice();
  while (level.length > 1) level = nextLevel(level);
  return level[0];
}

export interface InclusionProof {
  index: number;
  siblings: { hash: Hex; side: 'L' | 'R' }[];
}

/** Build the inclusion (Merkle) proof for the leaf at `index`. */
export function buildInclusionProof(leafHashes: Uint8Array[], index: number): InclusionProof {
  if (index < 0 || index >= leafHashes.length) throw new Error('merkle: index out of range');
  const siblings: { hash: Hex; side: 'L' | 'R' }[] = [];
  let level = leafHashes.slice();
  let idx = index;
  while (level.length > 1) {
    const isRight = idx % 2 === 1;
    const sibIdx = isRight ? idx - 1 : idx + 1;
    // A lone promoted node (sibIdx out of range) contributes no sibling at this level.
    if (sibIdx < level.length) {
      siblings.push({ hash: toHex(level[sibIdx]), side: isRight ? 'L' : 'R' });
    }
    idx = Math.floor(idx / 2);
    level = nextLevel(level);
  }
  return { index, siblings };
}

/** Verify a leaf hash + inclusion proof reproduce `rootHex`. */
export function verifyInclusionProof(leafHash: Uint8Array, proof: InclusionProof, rootHex: Hex): boolean {
  let acc = leafHash;
  for (const sib of proof.siblings) {
    const sh = fromHex(sib.hash);
    acc = sib.side === 'L' ? hashNode(sh, acc) : hashNode(acc, sh);
  }
  return toHex(acc) === rootHex.toLowerCase();
}
