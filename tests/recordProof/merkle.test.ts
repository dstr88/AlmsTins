import { describe, it, expect } from 'vitest';
import { concatBytes } from '@noble/hashes/utils.js';
import {
  hashLeaf, hashNode, buildMerkleRoot, buildInclusionProof, verifyInclusionProof, toHex,
} from '@/lib/recordProof/merkle';

const leaf = (s: string) => hashLeaf(new TextEncoder().encode(s));

describe('merkle', () => {
  it('root is stable for a fixed leaf order, 64-hex', () => {
    const r1 = toHex(buildMerkleRoot(['a', 'b', 'c'].map(leaf)));
    const r2 = toHex(buildMerkleRoot(['a', 'b', 'c'].map(leaf)));
    expect(r1).toBe(r2);
    expect(r1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different leaf order → different root', () => {
    expect(toHex(buildMerkleRoot(['a', 'b'].map(leaf)))).not.toBe(toHex(buildMerkleRoot(['b', 'a'].map(leaf))));
  });

  it('single-leaf root equals the leaf hash', () => {
    const l = leaf('only');
    expect(toHex(buildMerkleRoot([l]))).toBe(toHex(l));
  });

  it('domain separation: node(0x01||a||b) ≠ a leaf hash of the same concatenation', () => {
    const a = leaf('a');
    const b = leaf('b');
    expect(toHex(hashNode(a, b))).not.toBe(toHex(hashLeaf(concatBytes(a, b))));
    const root = buildMerkleRoot([a, b]);
    expect(toHex(root)).not.toBe(toHex(a));
    expect(toHex(root)).not.toBe(toHex(b));
  });

  it.each([1, 2, 3, 4, 5, 8, 9, 16, 17, 100, 1000])(
    'every inclusion proof verifies against the root (n=%i, exercises odd promotion)',
    (n) => {
      const leaves = Array.from({ length: n }, (_, i) => leaf(`leaf-${i}`));
      const rootHex = toHex(buildMerkleRoot(leaves));
      for (let i = 0; i < n; i++) {
        expect(verifyInclusionProof(leaves[i], buildInclusionProof(leaves, i), rootHex)).toBe(true);
      }
    },
  );

  it('a tampered sibling fails verification', () => {
    const leaves = ['a', 'b', 'c', 'd'].map(leaf);
    const rootHex = toHex(buildMerkleRoot(leaves));
    const proof = buildInclusionProof(leaves, 0);
    proof.siblings[0].hash = toHex(leaf('evil'));
    expect(verifyInclusionProof(leaves[0], proof, rootHex)).toBe(false);
  });

  it('a tampered leaf fails verification against the original root', () => {
    const leaves = ['a', 'b', 'c'].map(leaf);
    const rootHex = toHex(buildMerkleRoot(leaves));
    const proof = buildInclusionProof(leaves, 1);
    expect(verifyInclusionProof(leaf('not-b'), proof, rootHex)).toBe(false);
  });

  it('index out of range throws', () => {
    expect(() => buildInclusionProof(['a'].map(leaf), 5)).toThrow();
  });
});
