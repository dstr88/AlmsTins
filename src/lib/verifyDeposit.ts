/**
 * Almstins Verify — self-send proof of control (read-only chain observation).
 *
 * Proof model: the merchant sends ANY outgoing transaction FROM the address they
 * registered, after we issue a challenge. Only the keyholder can originate a tx,
 * so a new outgoing tx proves they control the address. Almstins never sends,
 * holds, or signs — it only READS public chain data. A breach of Almstins still
 * can't move a coin, because there is nothing to move.
 *
 * "Outgoing" per rail:
 *   - EVM (eth/polygon/avalanche): any tx with from == address (native send, token
 *     send, or contract call — all are signed by the address; even a reverted one).
 *   - Bitcoin / Litecoin (esplora): a tx that SPENDS an input belonging to the
 *     address (vin.prevout.scriptpubkey_address == address).
 *   - Solana: a tx after which the address's lamport balance DECREASED (it paid
 *     fees / sent) — only the keyholder can cause their own balance to drop.
 */
import { buildEtherscanV2Url, requestEtherscan, CHAIN_IDS } from '@/lib/etherscan';

export type DepositOutcome =
  | { found: true; ref: string } // a qualifying outgoing tx; ref is its hash/signature
  | { found: false; reason: 'no_activity' | 'unsupported_rail' | 'unavailable' };

const EVM_RAILS = new Set(['ethereum', 'polygon', 'avalanche']);
const ESPLORA_BASE: Record<string, string> = {
  bitcoin: 'https://blockstream.info/api',
  litecoin: 'https://litecoinspace.org/api',
};
const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const HTTP_TIMEOUT_MS = 8000;

/** Parse the registry's "YYYY-MM-DD HH:MM:SS" UTC stamp to epoch seconds. */
function toEpochSeconds(sinceUtc: string): number {
  const ms = Date.parse(sinceUtc.replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/**
 * Did `address` originate a new outgoing transaction after `sinceUtc`?
 * Read-only. Returns the proving tx ref on success; never throws (fails to
 * `unavailable` so the caller surfaces "couldn't reach the chain, try again").
 */
export async function detectOutgoingSince(rail: string, address: string, sinceUtc: string): Promise<DepositOutcome> {
  const since = toEpochSeconds(sinceUtc);
  const addr = (address ?? '').trim();
  if (!addr) return { found: false, reason: 'unsupported_rail' };
  try {
    if (EVM_RAILS.has(rail)) return await detectEvm(rail, addr, since);
    if (ESPLORA_BASE[rail]) return await detectEsplora(ESPLORA_BASE[rail], addr, since);
    if (rail === 'solana') return await detectSolana(addr, since);
    return { found: false, reason: 'unsupported_rail' };
  } catch {
    return { found: false, reason: 'unavailable' };
  }
}

async function detectEvm(rail: string, address: string, since: number): Promise<DepositOutcome> {
  const chainId = (CHAIN_IDS as Record<string, number>)[rail];
  const url = buildEtherscanV2Url(chainId, {
    module: 'account', action: 'txlist', address,
    startblock: 0, endblock: 99999999, page: 1, offset: 50, sort: 'desc',
  });
  if (!url) return { found: false, reason: 'unavailable' }; // explorer API key not configured
  const payload = (await requestEtherscan(url)) as { result?: unknown };
  const rows = Array.isArray(payload?.result) ? (payload.result as Array<Record<string, unknown>>) : [];
  const addr = address.toLowerCase();
  const hit = rows.find(
    (r) => String(r.from ?? '').toLowerCase() === addr && Number(r.timeStamp ?? 0) > since,
  );
  return hit ? { found: true, ref: String(hit.hash) } : { found: false, reason: 'no_activity' };
}

async function detectEsplora(base: string, address: string, since: number): Promise<DepositOutcome> {
  const res = await fetch(`${base}/address/${encodeURIComponent(address)}/txs`, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) return { found: false, reason: 'unavailable' };
  const txs = (await res.json()) as Array<Record<string, any>>;
  if (!Array.isArray(txs)) return { found: false, reason: 'unavailable' };
  for (const tx of txs) {
    const spentHere = Array.isArray(tx.vin) && tx.vin.some((i: any) => i?.prevout?.scriptpubkey_address === address);
    if (!spentHere) continue;
    // Unconfirmed (mempool) counts as "just now"; otherwise require block_time after issue.
    const confirmed = Boolean(tx?.status?.confirmed);
    if (!confirmed || Number(tx?.status?.block_time ?? 0) > since) {
      return { found: true, ref: String(tx.txid) };
    }
  }
  return { found: false, reason: 'no_activity' };
}

async function detectSolana(address: string, since: number): Promise<DepositOutcome> {
  const sigs = await solRpc<Array<{ signature: string; blockTime?: number | null }>>(
    'getSignaturesForAddress', [address, { limit: 25 }],
  );
  if (!Array.isArray(sigs)) return { found: false, reason: 'unavailable' };
  for (const s of sigs) {
    if (!s.blockTime || s.blockTime <= since) continue;
    const tx = await solRpc<any>('getTransaction', [s.signature, { maxSupportedTransactionVersion: 0, encoding: 'json' }]);
    const keys: any[] = tx?.transaction?.message?.accountKeys ?? [];
    const idx = keys.findIndex((k) => (typeof k === 'string' ? k : k?.pubkey) === address);
    if (idx < 0) continue;
    const pre = Number(tx?.meta?.preBalances?.[idx] ?? 0);
    const post = Number(tx?.meta?.postBalances?.[idx] ?? 0);
    if (post < pre) return { found: true, ref: s.signature }; // balance dropped → the address signed/spent
  }
  return { found: false, reason: 'no_activity' };
}

async function solRpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: T };
    return json?.result ?? null;
  } catch {
    return null;
  }
}
