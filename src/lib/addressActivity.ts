/**
 * Address activity — read-only, public-chain "funds in / funds out" for ONE address.
 *
 * This is the reading half of a cross-product delegation: sister products (e.g.
 * SusuFinance) don't carry chain-reading code, so they ask Almstins "what has moved
 * in and out of this address?" the same way they ask Verify "is this address proven?".
 * Almstins already reads chains for a living; this reuses that infra (Etherscan v2 for
 * EVM, esplora for BTC/LTC) and returns a normalized recent-activity list.
 *
 * It reports PUBLIC chain data about a single supplied address — never who owns it.
 * No attribution: it returns the counterparty ADDRESS on each transfer (as any block
 * explorer does), never a name or identity. Consistent with the no-custody / read-only
 * boundary: reading can never move a coin.
 *
 * Never throws — failures collapse to { ok:false, reason } so the caller can say
 * "couldn't reach the chain, try again" instead of 500-ing.
 */
import {
  buildEtherscanV2Url,
  requestEtherscan,
  CHAIN_IDS,
  weiToDecimalString,
  getTokentxPage,
} from '@/lib/etherscan';
import { detectChain } from '@/lib/walletChecker';

export type ActivityItem = {
  direction: 'in' | 'out';
  amount: string;        // decimal string, token/native units
  asset: string;         // ETH / POL / AVAX / BTC / LTC / token symbol
  counterparty: string;  // the other address on the transfer (best-effort for UTXO)
  hash: string;
  timestamp: number;     // epoch seconds (0 if unconfirmed/unknown)
};

export type ActivityResult =
  | { ok: true; chain: string; network: string | null; activity: ActivityItem[]; truncated: boolean }
  | { ok: false; reason: 'unsupported' | 'unavailable' };

const EVM_NETWORKS: Record<string, number> = {
  ethereum: (CHAIN_IDS as Record<string, number>).ethereum,
  polygon: (CHAIN_IDS as Record<string, number>).polygon,
  avalanche: (CHAIN_IDS as Record<string, number>).avalanche,
};
const NATIVE_SYMBOL: Record<string, string> = {
  ethereum: 'ETH',
  polygon: 'POL',
  avalanche: 'AVAX',
};
const ESPLORA_BASE: Record<string, string> = {
  bitcoin: 'https://blockstream.info/api',
  litecoin: 'https://litecoinspace.org/api',
};
const HTTP_TIMEOUT_MS = 8000;
const LIMIT = 25; // most-recent items returned

/**
 * Recent in/out activity for `address`. For EVM the specific network can't be told
 * from the address alone (the same 0x… lives on every chain), so the caller names it;
 * absent/unknown → ethereum.
 */
export async function getAddressActivity(address: string, networkParam?: string): Promise<ActivityResult> {
  const addr = (address ?? '').trim();
  if (!addr) return { ok: false, reason: 'unsupported' };
  const chain = detectChain(addr);
  if (chain === 'evm') {
    const network = networkParam && EVM_NETWORKS[networkParam] ? networkParam : 'ethereum';
    return evmActivity(network, addr);
  }
  if (chain === 'bitcoin' || chain === 'litecoin') return esploraActivity(chain, addr);
  // Solana/Tron/XRP/etc. — not read here yet; caller shows "chain not watched".
  return { ok: false, reason: 'unsupported' };
}

async function evmActivity(network: string, address: string): Promise<ActivityResult> {
  const chainId = EVM_NETWORKS[network];
  if (!chainId) return { ok: false, reason: 'unsupported' };
  const addr = address.toLowerCase();
  const nativeSym = NATIVE_SYMBOL[network] ?? 'ETH';
  const items: ActivityItem[] = [];
  let reachedAny = false;

  // Native sends/receives. value=0 rows are contract calls with no fund movement — skip.
  const nativeUrl = buildEtherscanV2Url(chainId, {
    module: 'account',
    action: 'txlist',
    address,
    startblock: 0,
    endblock: 99999999,
    page: 1,
    offset: 50,
    sort: 'desc',
  });
  if (nativeUrl) {
    try {
      const payload = (await requestEtherscan(nativeUrl)) as { result?: unknown };
      const rows = Array.isArray(payload?.result) ? (payload.result as Array<Record<string, unknown>>) : [];
      reachedAny = true;
      for (const r of rows) {
        let value: bigint;
        try { value = BigInt(String(r.value ?? '0')); } catch { continue; }
        if (value === 0n) continue;
        const from = String(r.from ?? '').toLowerCase();
        const to = String(r.to ?? '').toLowerCase();
        const dir: 'in' | 'out' | null = from === addr ? 'out' : to === addr ? 'in' : null;
        if (!dir) continue;
        items.push({
          direction: dir,
          amount: weiToDecimalString(value, 18),
          asset: nativeSym,
          counterparty: dir === 'out' ? to : from,
          hash: String(r.hash ?? ''),
          timestamp: Number(r.timeStamp ?? 0),
        });
      }
    } catch { /* non-fatal — fall through to token transfers */ }
  }

  // ERC-20 transfers (a susu contribution is often a stablecoin, not native).
  try {
    const toks = await getTokentxPage({ chainId, address, page: 1, offset: 50 });
    reachedAny = true;
    for (const t of toks) {
      const from = String(t.from ?? '').toLowerCase();
      const to = String(t.to ?? '').toLowerCase();
      const dir: 'in' | 'out' | null = from === addr ? 'out' : to === addr ? 'in' : null;
      if (!dir) continue;
      const decimals = Number(t.tokenDecimal ?? '18') || 18;
      let value: bigint;
      try { value = BigInt(String(t.value ?? '0')); } catch { continue; }
      items.push({
        direction: dir,
        amount: weiToDecimalString(value, decimals),
        asset: t.tokenSymbol || 'token',
        counterparty: dir === 'out' ? to : from,
        hash: String(t.hash ?? ''),
        timestamp: Number(t.timeStamp ?? 0),
      });
    }
  } catch { /* non-fatal */ }

  if (!reachedAny) return { ok: false, reason: 'unavailable' };
  items.sort((a, b) => b.timestamp - a.timestamp);
  return { ok: true, chain: 'evm', network, activity: items.slice(0, LIMIT), truncated: items.length > LIMIT };
}

async function esploraActivity(chain: 'bitcoin' | 'litecoin', address: string): Promise<ActivityResult> {
  const base = ESPLORA_BASE[chain];
  const asset = chain === 'bitcoin' ? 'BTC' : 'LTC';
  let txs: Array<Record<string, any>>;
  try {
    const res = await fetch(`${base}/address/${encodeURIComponent(address)}/txs`, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    txs = (await res.json()) as Array<Record<string, any>>;
    if (!Array.isArray(txs)) return { ok: false, reason: 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  const items: ActivityItem[] = [];
  for (const tx of txs) {
    // UTXO nets out per tx: (received to us) − (spent from us). Sign gives direction.
    let spentSat = 0;   // our inputs consumed
    let receivedSat = 0; // outputs paid to us
    let cpIn = '';       // a sender address (for money coming in)
    let cpOut = '';      // a recipient address (for money going out)
    for (const v of tx.vin ?? []) {
      const a = v?.prevout?.scriptpubkey_address;
      if (a === address) spentSat += Number(v?.prevout?.value ?? 0);
      else if (a && !cpIn) cpIn = a;
    }
    for (const o of tx.vout ?? []) {
      const a = o?.scriptpubkey_address;
      if (a === address) receivedSat += Number(o?.value ?? 0);
      else if (a && !cpOut) cpOut = a;
    }
    const net = receivedSat - spentSat;
    if (net === 0) continue;
    const dir: 'in' | 'out' = net > 0 ? 'in' : 'out';
    items.push({
      direction: dir,
      amount: weiToDecimalString(BigInt(Math.abs(net)), 8),
      asset,
      counterparty: dir === 'out' ? cpOut : cpIn,
      hash: String(tx.txid ?? ''),
      timestamp: Number(tx?.status?.block_time ?? 0),
    });
  }
  items.sort((a, b) => b.timestamp - a.timestamp);
  return { ok: true, chain, network: null, activity: items.slice(0, LIMIT), truncated: items.length > LIMIT };
}
