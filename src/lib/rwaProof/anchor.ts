// Anchors pin a digest to an INDEPENDENT source of time so a proof's provenAt
// cannot be backdated. Production anchors derive `anchoredAt` from something
// Almstins does not control (OpenTimestamps → Bitcoin, or an RFC-3161 TSA).
//
// LocalAnchor here is the in-process reference implementation + test double: it
// proves the interface and the digest-binding, and is fully deterministic and
// offline. It does NOT provide independent time — swap in OpenTimestampsAnchor
// (anchorOpenTimestamps.ts) for that. Keeping the seam explicit is the point:
// the proof format is anchor-agnostic, so the trust source is a plug, not a rewrite.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Hex } from '@/lib/recordProof/merkle';
import type { AnchorReceipt } from './types';

export interface Anchor {
  readonly type: string;
  /** Commit a digest; return a receipt whose `anchoredAt` is set by the anchor source (null until confirmed). */
  stamp(digestHex: Hex): Promise<AnchorReceipt>;
  /** Independently confirm the digest was anchored; return the source's existence-by time when available. */
  verify(digestHex: Hex, receipt: AnchorReceipt): Promise<{ ok: boolean; anchoredAt: string | null }>;
}

/**
 * Append-only, hash-chained commitment log kept in memory (or an injected clock).
 * Reference/test anchor only. `anchoredAt` comes from the injected clock, so it is
 * NOT tamper-proof time — do not rely on LocalAnchor for real backdating defense.
 */
export class LocalAnchor implements Anchor {
  readonly type = 'local-merkle';
  private log: { digest: Hex; prev: Hex; at: string }[] = [];

  constructor(private now: () => string = () => new Date().toISOString()) {}

  private headHash(): Hex {
    if (this.log.length === 0) return '00'.repeat(32);
    const last = this.log[this.log.length - 1];
    return bytesToHex(sha256(utf8ToBytes(last.prev + last.digest + last.at)));
  }

  async stamp(digestHex: Hex): Promise<AnchorReceipt> {
    const digest = digestHex.toLowerCase();
    const prev = this.headHash();
    const at = this.now();
    this.log.push({ digest, prev, at });
    const receipt = Buffer.from(JSON.stringify({ prev, at }), 'utf8').toString('base64');
    return { type: this.type, digest, receipt, anchoredAt: at };
  }

  async verify(digestHex: Hex, receipt: AnchorReceipt): Promise<{ ok: boolean; anchoredAt: string | null }> {
    if (receipt.type !== this.type) return { ok: false, anchoredAt: null };
    const digest = digestHex.toLowerCase();
    if (receipt.digest.toLowerCase() !== digest) return { ok: false, anchoredAt: null };
    let parsed: { prev: Hex; at: string };
    try {
      parsed = JSON.parse(Buffer.from(receipt.receipt, 'base64').toString('utf8'));
    } catch {
      return { ok: false, anchoredAt: null };
    }
    const found = this.log.some(
      (e) => e.digest === digest && e.prev === parsed.prev && e.at === parsed.at,
    );
    return { ok: found, anchoredAt: found ? parsed.at : null };
  }
}
