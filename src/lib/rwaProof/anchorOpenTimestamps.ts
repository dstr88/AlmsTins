// Production anchor: OpenTimestamps → Bitcoin. Free. The .ots receipt is "pending"
// until Bitcoin confirms (~1 hr), after which `anchoredAt` resolves to the block
// time — a value Almstins cannot forge or backdate. That independence is the whole
// reason this exists; LocalAnchor cannot provide it.
//
// Requires the optional `opentimestamps` package:  npm i opentimestamps
// It is imported lazily so the rest of rwaProof builds and tests without it.
//
// NOTE: this is the intended wiring against the opentimestamps API. Before relying
// on it in production, run one live stamp+upgrade+verify cycle and confirm the
// field shapes below against the installed version — it is not exercised by the
// offline unit tests (they use LocalAnchor).

import type { Hex } from '@/lib/recordProof/merkle';
import type { Anchor } from './anchor';
import type { AnchorReceipt } from './types';

export class OpenTimestampsAnchor implements Anchor {
  readonly type = 'opentimestamps';

  private async lib(): Promise<any> {
    try {
      // opentimestamps ships a broken package.json "main" that Vite's static resolver
      // rejects (Node resolves it fine at runtime). A variable specifier + @vite-ignore
      // keeps this import opaque to the bundler so it stays a plain runtime import.
      const spec = 'opentimestamps';
      const mod: any = await import(/* @vite-ignore */ spec);
      return mod.default ?? mod;
    } catch {
      throw new Error(
        "OpenTimestampsAnchor requires the 'opentimestamps' package (npm i opentimestamps).",
      );
    }
  }

  async stamp(digestHex: Hex): Promise<AnchorReceipt> {
    const ots = await this.lib();
    const digest = Uint8Array.from(Buffer.from(digestHex, 'hex'));
    const detached = ots.DetachedTimestampFile.fromHash(new ots.Ops.OpSHA256(), digest);
    await ots.stamp(detached); // submits to calendar servers
    const receipt = Buffer.from(detached.serializeToBytes()).toString('base64');
    return { type: this.type, digest: digestHex.toLowerCase(), receipt, anchoredAt: null };
  }

  async verify(digestHex: Hex, receipt: AnchorReceipt): Promise<{ ok: boolean; anchoredAt: string | null }> {
    if (receipt.type !== this.type) return { ok: false, anchoredAt: null };
    if (receipt.digest.toLowerCase() !== digestHex.toLowerCase()) return { ok: false, anchoredAt: null };
    const ots = await this.lib();
    const digest = Uint8Array.from(Buffer.from(digestHex, 'hex'));
    const original = ots.DetachedTimestampFile.fromHash(new ots.Ops.OpSHA256(), digest);
    const proof = ots.DetachedTimestampFile.deserialize(
      Uint8Array.from(Buffer.from(receipt.receipt, 'base64')),
    );
    const res: any = await ots.verify(proof, original);
    const seconds: number | null = res?.bitcoin?.timestamp ?? null;
    // ok=true means the receipt is a well-formed OTS proof for this digest; a null
    // anchoredAt just means Bitcoin has not confirmed it yet (still pending).
    return { ok: true, anchoredAt: seconds ? new Date(seconds * 1000).toISOString() : null };
  }

  /**
   * Fetch Bitcoin confirmation for a pending receipt. Call periodically after stamping;
   * once the calendars carry the Bitcoin attestation (~1-2h), the returned receipt's
   * anchoredAt resolves to the block time. Idempotent and non-fatal (returns the receipt
   * unchanged if the calendars are unreachable or it is not yet confirmable).
   */
  async upgrade(receipt: AnchorReceipt): Promise<AnchorReceipt> {
    if (receipt.type !== this.type) return receipt;
    const ots = await this.lib();
    const detached = ots.DetachedTimestampFile.deserialize(
      Uint8Array.from(Buffer.from(receipt.receipt, 'base64')),
    );
    try {
      await ots.upgrade(detached);
    } catch {
      return receipt;
    }
    const digest = Uint8Array.from(Buffer.from(receipt.digest, 'hex'));
    const original = ots.DetachedTimestampFile.fromHash(new ots.Ops.OpSHA256(), digest);
    const res: any = await ots.verify(detached, original);
    const seconds: number | null = res?.bitcoin?.timestamp ?? null;
    return {
      ...receipt,
      receipt: Buffer.from(detached.serializeToBytes()).toString('base64'),
      anchoredAt: seconds ? new Date(seconds * 1000).toISOString() : receipt.anchoredAt,
    };
  }
}
