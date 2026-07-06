/**
 * walletChecker.ts
 *
 * Public wallet scam checker — used by /api/wallet-check
 *
 * Security measures baked in:
 *   - Strict address validation before ANY external fetch (SSRF prevention)
 *   - In-memory rate limiter: 10 req/min per IP, rolling window
 *   - In-memory LRU result cache: 500 entries max, 5-min TTL
 *   - 8-second AbortController timeout on every upstream call
 *   - All upstream errors are non-fatal — collected in result.errors[]
 *   - Checked addresses are NEVER logged or persisted to the database
 */

// ─── Address detection ────────────────────────────────────────────────────────

const EVM_REGEX     = /^0x[0-9a-fA-F]{40}$/;
const SUI_REGEX     = /^0x[0-9a-fA-F]{64}$/;
const SOLANA_REGEX  = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// Bitcoin: Legacy (1...), P2SH (3...), Bech32 (bc1...)
const BTC_REGEX     = /^(1[a-km-zA-HJ-NP-Z1-9]{25,34}|3[a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-zA-HJ-NP-Z0-9]{6,87})$/;
// Litecoin: Legacy (L/M...), P2SH (3...), Bech32 (ltc1...)
const LTC_REGEX     = /^([LM][a-km-zA-HJ-NP-Z1-9]{26,33}|3[a-km-zA-HJ-NP-Z1-9]{25,34}|ltc1[a-zA-HJ-NP-Z0-9]{6,87})$/;
// TRON: T + 33 base58 chars
const TRON_REGEX    = /^T[a-km-zA-HJ-NP-Z1-9]{33}$/;
// XRP: r + 24–33 base58 chars (no 0, O, I, l)
const XRP_REGEX     = /^r[a-km-zA-HJ-NP-Z1-9]{24,33}$/;
// Dogecoin: D + 33 base58 chars
const DOGE_REGEX    = /^D[a-km-zA-HJ-NP-Z1-9]{33}$/;
// Cardano: mainnet Shelley (addr1...) or Byron (Ae2... / DdzFF...)
const CARDANO_REGEX = /^(addr1[a-z0-9]{50,100}|Ae2[a-km-zA-HJ-NP-Z1-9]{54,}|DdzFF[a-km-zA-HJ-NP-Z1-9]{90,})$/;
// Cosmos Hub: cosmos1 + 38 bech32 chars
const COSMOS_REGEX  = /^cosmos1[a-z0-9]{38}$/;

export type Chain = 'evm' | 'sui' | 'solana' | 'bitcoin' | 'litecoin' | 'tron' | 'xrp' | 'dogecoin' | 'cardano' | 'cosmos' | 'unknown';

// Chains where safety checks run
const SUPPORTED_CHAINS = new Set<Chain>(['evm', 'sui', 'solana', 'bitcoin', 'litecoin', 'tron']);

export function detectChain(address: string): Chain {
  if (SUI_REGEX.test(address))     return 'sui';       // check before EVM (both start with 0x)
  if (EVM_REGEX.test(address))     return 'evm';
  if (TRON_REGEX.test(address))    return 'tron';      // check before Solana (base58 overlap)
  if (XRP_REGEX.test(address))     return 'xrp';       // r-prefix, before Solana
  if (DOGE_REGEX.test(address))    return 'dogecoin';  // D-prefix, before Solana
  if (CARDANO_REGEX.test(address)) return 'cardano';
  if (COSMOS_REGEX.test(address))  return 'cosmos';
  if (SOLANA_REGEX.test(address))  return 'solana';
  if (LTC_REGEX.test(address))     return 'litecoin';  // check before BTC (some overlap on 3...)
  if (BTC_REGEX.test(address))     return 'bitcoin';
  return 'unknown';
}

export function isValidAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  const trimmed = address.trim();
  if (trimmed.length < 25 || trimmed.length > 128) return false;
  return detectChain(trimmed) !== 'unknown';
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

interface RateEntry { count: number; resetAt: number }
const _rateLimiter = new Map<string, RateEntry>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

// Prune stale entries every 5 min to avoid memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _rateLimiter) {
    if (now > entry.resetAt) _rateLimiter.delete(ip);
  }
}, 5 * 60_000);

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = _rateLimiter.get(ip);
  if (!entry || now > entry.resetAt) {
    _rateLimiter.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface WalletCheckResult {
  address: string;
  chain: Chain;
  checkedAt: string;
  scamScore: number;       // 0–100
  scamLevel: 'clean' | 'caution' | 'danger';
  flags: {
    blacklisted: boolean;
    phishing: boolean;
    honeypotRelated: boolean;
    stealingAttack: boolean;
    darkwebTransactions: boolean;
    cybercrime: boolean;
    moneyLaundering: boolean;
    financialCrime: boolean;
    blackmail: boolean;
    mixer: boolean;
    sanctioned: boolean;
  };
  ensName: string | null;
  multiSig: boolean | null;
  chainabuseReports: number | null;
  holdings: Array<{
    symbol: string;
    name: string;
    balance: string;
    usdValue: number | null;
  }>;
  activity: {
    firstSeen: string | null;
    lastActivity: string | null;
    txCount: number | null;
    totalReceivedEth: string | null;
    totalSentEth: string | null;
    ethBalance: string | null;
  };
  honeypot: {
    checked: boolean;
    isHoneypot: boolean | null;
    reason: string | null;
  };
  fundingSource: {
    fromMixer: boolean | null;
    fromExchange: boolean | null;
    label: string | null;
  };
  entityLabel: {
    name: string;
    type: 'exchange' | 'contract' | 'defi' | 'bridge';
    subLabel: string | null;
    url: string | null;
    confidence: 'definite' | 'likely';
  } | null;
  errors: string[];
  /** Which scam sources actually ran for this address's chain (P0/P1 honesty). */
  coverage: {
    goplus: 'ran' | 'skipped' | 'error';
    honeypot: 'ran' | 'skipped' | 'error';
    chainabuse: 'ran' | 'skipped' | 'error';
  };
  /** True when no PRIMARY scam source ran for this chain — a "clean" must NOT read as a confident green. */
  partialCoverage: boolean;
}

// ─── In-memory LRU cache ──────────────────────────────────────────────────────

interface CacheEntry { data: WalletCheckResult; expiresAt: number }
const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 500;

export function getCached(address: string): WalletCheckResult | null {
  const key = address.toLowerCase();
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.data;
}

export function setCache(address: string, data: WalletCheckResult): void {
  if (_cache.size >= CACHE_MAX) {
    const oldest = _cache.keys().next().value;
    if (oldest) _cache.delete(oldest);
  }
  _cache.set(address.toLowerCase(), { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Scam score ───────────────────────────────────────────────────────────────

const FLAG_WEIGHTS: Record<keyof WalletCheckResult['flags'], number> = {
  sanctioned:          100,
  blacklisted:          90,
  phishing:             80,
  stealingAttack:       80,
  honeypotRelated:      70,
  cybercrime:           70,
  financialCrime:       65,
  moneyLaundering:      60,
  darkwebTransactions:  60,
  blackmail:            50,
  mixer:                40,
};

export function calculateScamScore(flags: WalletCheckResult['flags']): {
  score: number;
  level: WalletCheckResult['scamLevel'];
} {
  const maxPossible = Object.values(FLAG_WEIGHTS).reduce((a, b) => a + b, 0);
  let raw = 0;
  for (const [key, weight] of Object.entries(FLAG_WEIGHTS)) {
    if (flags[key as keyof typeof flags]) raw += weight;
  }
  const score = Math.min(100, Math.round((raw / maxPossible) * 100));
  const level: WalletCheckResult['scamLevel'] =
    score === 0 ? 'clean' : score < 40 ? 'caution' : 'danger';
  return { score, level };
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

const TIMEOUT_MS = 8_000;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

// GoPlus chain IDs — check EVM across multiple chains, merge flags
// Solana supported; Bitcoin/Litecoin/Sui not supported by this endpoint
const GOPLUS_EVM_CHAINS = [
  { id: '1',   label: 'Ethereum' },
  { id: '56',  label: 'BSC' },
  { id: '137', label: 'Polygon' },
];

// GoPlus Security — free, no API key needed
// https://gopluslabs.io/
async function fetchGoPlusFlags(
  address: string,
): Promise<{ flags: Partial<WalletCheckResult['flags']>; errors: string[] }> {
  const errors: string[] = [];
  const flags: Partial<WalletCheckResult['flags']> = {};
  const chain = detectChain(address);

  if (chain === 'bitcoin' || chain === 'litecoin' || chain === 'sui' || chain === 'unknown'
      || chain === 'xrp' || chain === 'dogecoin' || chain === 'cardano' || chain === 'cosmos') {
    return { flags, errors }; // chain not supported — skip silently
  }

  const chainIds = chain === 'evm'    ? GOPLUS_EVM_CHAINS
                 : chain === 'solana' ? [{ id: 'solana', label: 'Solana' }]
                 :                     [{ id: 'tron',   label: 'TRON'   }];

  const flag = (v: unknown) => String(v) === '1';

  // Run all chain checks in parallel and merge (any positive flag wins)
  await Promise.allSettled(chainIds.map(async ({ id, label }) => {
    try {
      const res = await fetchWithTimeout(
        `https://api.gopluslabs.io/api/v1/address_security/${encodeURIComponent(address)}?chain_id=${id}`,
      );
      if (!res.ok) { errors.push(`GoPlus(${label}) returned ${res.status}`); return; }
      const json = await res.json() as Record<string, any>;
      const d = json?.result ?? {};
      // OR-merge: once a flag is true on any chain it stays true
      if (flag(d.blacklist_doubt))          flags.blacklisted         = true;
      if (flag(d.phishing_activities))      flags.phishing            = true;
      if (flag(d.honeypot_related_address)) flags.honeypotRelated     = true;
      if (flag(d.stealing_attack))          flags.stealingAttack      = true;
      if (flag(d.darkweb_transactions))     flags.darkwebTransactions = true;
      if (flag(d.cybercrime))               flags.cybercrime          = true;
      if (flag(d.money_laundering))         flags.moneyLaundering     = true;
      if (flag(d.financial_crime))          flags.financialCrime      = true;
      if (flag(d.blackmail_activities))     flags.blackmail           = true;
      if (flag(d.mixer))                    flags.mixer               = true;
      if (flag(d.sanctioned))               flags.sanctioned          = true;
    } catch {
      errors.push(`GoPlus(${label}) unavailable`);
    }
  }));

  return { flags, errors };
}

// Etherscan — wallet age, tx count, ETH balance
async function fetchEtherscanActivity(
  address: string,
): Promise<{ activity: WalletCheckResult['activity']; errors: string[] }> {
  const errors: string[] = [];
  const activity: WalletCheckResult['activity'] = {
    firstSeen: null, lastActivity: null, txCount: null,
    totalReceivedEth: null, totalSentEth: null, ethBalance: null,
  };

  const apiKey = import.meta.env.ETHERSCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY ?? '';
  if (!apiKey) { errors.push('Etherscan not configured'); return { activity, errors }; }

  const base = `https://api.etherscan.io/v2/api?chainid=1&apikey=${apiKey}`;

  try {
    // First tx (age)
    const firstRes = await fetchWithTimeout(
      `${base}&module=account&action=txlist&address=${address}&sort=asc&page=1&offset=1`,
    );
    if (firstRes.ok) {
      const j = await firstRes.json() as any;
      const first = j?.result?.[0];
      if (first?.timeStamp) {
        activity.firstSeen = new Date(Number(first.timeStamp) * 1000).toISOString();
      }
    }
  } catch { errors.push('Etherscan first-tx unavailable'); }

  try {
    // Last tx
    const lastRes = await fetchWithTimeout(
      `${base}&module=account&action=txlist&address=${address}&sort=desc&page=1&offset=1`,
    );
    if (lastRes.ok) {
      const j = await lastRes.json() as any;
      const last = j?.result?.[0];
      if (last?.timeStamp) {
        activity.lastActivity = new Date(Number(last.timeStamp) * 1000).toISOString();
      }
      // Rough tx count via offset trick (Etherscan caps at 10k)
      if (Array.isArray(j?.result)) {
        activity.txCount = j.result.length > 0 ? null : 0;
      }
    }
  } catch { errors.push('Etherscan last-tx unavailable'); }

  try {
    // ETH balance
    const balRes = await fetchWithTimeout(
      `${base}&module=account&action=balance&address=${address}&tag=latest`,
    );
    if (balRes.ok) {
      const j = await balRes.json() as any;
      if (j?.result) {
        const wei = BigInt(j.result);
        const eth = Number(wei) / 1e18;
        activity.ethBalance = eth.toFixed(6);
      }
    }
  } catch { errors.push('Etherscan balance unavailable'); }

  return { activity, errors };
}

// Alchemy — ERC-20 token balances
async function fetchTokenBalances(
  address: string,
): Promise<{ holdings: WalletCheckResult['holdings']; errors: string[] }> {
  const errors: string[] = [];
  const holdings: WalletCheckResult['holdings'] = [];

  const apiKey = process.env.ALCHEMY_API_KEY ?? import.meta.env.ALCHEMY_API_KEY ?? '';
  if (!apiKey) { errors.push('Alchemy not configured'); return { holdings, errors }; }

  try {
    const res = await fetchWithTimeout(
      `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'alchemy_getTokenBalances',
          params: [address, 'erc20'],
        }),
      },
    );
    if (!res.ok) { errors.push(`Alchemy returned ${res.status}`); return { holdings, errors }; }
    const json = await res.json() as any;
    const balances: Array<{ contractAddress: string; tokenBalance: string }> =
      json?.result?.tokenBalances ?? [];

    // Fetch metadata for tokens with non-zero balance (cap at 10 to avoid quota burn)
    const nonZero = balances
      .filter(b => b.tokenBalance && b.tokenBalance !== '0x0000000000000000000000000000000000000000000000000000000000000000')
      .slice(0, 10);

    await Promise.allSettled(nonZero.map(async (b) => {
      try {
        const metaRes = await fetchWithTimeout(
          `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 1,
              method: 'alchemy_getTokenMetadata',
              params: [b.contractAddress],
            }),
          },
        );
        if (!metaRes.ok) return;
        const meta = await metaRes.json() as any;
        const m = meta?.result;
        if (!m) return;
        const decimals = m.decimals ?? 18;
        const rawBal = BigInt(b.tokenBalance);
        const balance = (Number(rawBal) / Math.pow(10, decimals)).toFixed(4);
        holdings.push({
          symbol: String(m.symbol ?? '???').slice(0, 12),
          name:   String(m.name   ?? 'Unknown').slice(0, 40),
          balance,
          usdValue: null, // price lookup would need another call — skip for now
        });
      } catch { /* skip this token */ }
    }));
  } catch (err) {
    errors.push('Alchemy unavailable');
  }

  return { holdings, errors };
}

// Honeypot.is — free, EVM only
async function fetchHoneypotCheck(
  address: string,
): Promise<{ honeypot: WalletCheckResult['honeypot']; errors: string[] }> {
  const errors: string[] = [];
  const honeypot: WalletCheckResult['honeypot'] = { checked: false, isHoneypot: null, reason: null };
  try {
    const res = await fetchWithTimeout(
      `https://api.honeypot.is/v2/IsHoneypot?address=${encodeURIComponent(address)}`,
    );
    if (!res.ok) { errors.push(`Honeypot.is returned ${res.status}`); return { honeypot, errors }; }
    const json = await res.json() as any;
    honeypot.checked    = true;
    honeypot.isHoneypot = Boolean(json?.isHoneypot);
    honeypot.reason     = typeof json?.honeypotReason === 'string'
      ? json.honeypotReason.slice(0, 120)
      : null;
  } catch {
    errors.push('Honeypot.is unavailable');
  }
  return { honeypot, errors };
}

// Check if address is a multi-sig contract (basic: check if it has code + is Gnosis Safe)
async function fetchMultiSigCheck(
  address: string,
): Promise<{ multiSig: boolean | null; errors: string[] }> {
  const errors: string[] = [];
  const apiKey = import.meta.env.ETHERSCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY ?? '';
  if (!apiKey) return { multiSig: null, errors: [] };
  try {
    const res = await fetchWithTimeout(
      `https://api.etherscan.io/v2/api?chainid=1&apikey=${apiKey}&module=contract&action=getabi&address=${address}`,
    );
    if (!res.ok) return { multiSig: null, errors };
    const json = await res.json() as any;
    // If ABI exists and mentions "execTransaction" or "confirmTransaction" → Gnosis Safe / multi-sig
    const abi = String(json?.result ?? '');
    const isMultiSig = abi.includes('execTransaction') ||
                       abi.includes('confirmTransaction') ||
                       abi.includes('submitTransaction');
    return { multiSig: json?.status === '1' ? isMultiSig : null, errors };
  } catch {
    errors.push('Multi-sig check unavailable');
    return { multiSig: null, errors };
  }
}

// ─── Sui RPC helpers ──────────────────────────────────────────────────────────

const SUI_RPC = 'https://fullnode.mainnet.sui.io/';
const MIST_PER_SUI = 1_000_000_000;

async function suiRpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetchWithTimeout(SUI_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Sui RPC ${res.status}`);
  const json = await res.json() as any;
  if (json.error) throw new Error(json.error.message ?? 'Sui RPC error');
  return json.result;
}

async function fetchSuiHoldings(
  address: string,
): Promise<{ holdings: WalletCheckResult['holdings']; errors: string[] }> {
  const errors: string[] = [];
  try {
    const balances = await suiRpc('suix_getAllBalances', [address]) as Array<{
      coinType: string; totalBalance: string;
    }>;

    // Fetch SUI price once from CoinGecko (free, no key)
    let suiPriceUsd: number | null = null;
    try {
      const priceRes = await fetchWithTimeout(
        'https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd',
      );
      if (priceRes.ok) {
        const p = await priceRes.json() as any;
        suiPriceUsd = p?.sui?.usd ?? null;
      }
    } catch { /* price optional */ }

    const holdings: WalletCheckResult['holdings'] = balances.map((b) => {
      // coinType looks like "0x2::sui::SUI" or "0xPKG::module::SYMBOL"
      const parts = b.coinType.split('::');
      const symbol = parts[parts.length - 1] ?? b.coinType;
      const isSui  = b.coinType === '0x2::sui::SUI';
      const amount = Number(b.totalBalance) / (isSui ? MIST_PER_SUI : 1e9);
      const usdValue = isSui && suiPriceUsd != null
        ? Math.round(amount * suiPriceUsd * 100) / 100
        : null;
      return {
        symbol,
        name: isSui ? 'Sui' : symbol,
        balance: amount.toLocaleString(undefined, { maximumFractionDigits: 6 }),
        usdValue,
      };
    });

    return { holdings, errors };
  } catch (err) {
    errors.push('Sui holdings unavailable');
    return { holdings: [], errors };
  }
}

async function fetchSuiActivity(
  address: string,
): Promise<{ activity: WalletCheckResult['activity']; errors: string[] }> {
  const errors: string[] = [];
  const activity: WalletCheckResult['activity'] = {
    firstSeen: null, lastActivity: null, txCount: null,
    totalReceivedEth: null, totalSentEth: null, ethBalance: null,
  };
  try {
    // Get last 50 transactions (most recent first) to find last activity
    const [toTxs, fromTxs] = await Promise.all([
      suiRpc('suix_queryTransactionBlocks', [
        { filter: { ToAddress: address }, options: { showInput: false } },
        null, 50, true,
      ]),
      suiRpc('suix_queryTransactionBlocks', [
        { filter: { FromAddress: address }, options: { showInput: false } },
        null, 50, true,
      ]),
    ]);

    const allDigests = [
      ...(toTxs?.data ?? []),
      ...(fromTxs?.data ?? []),
    ] as Array<{ digest: string; timestampMs?: string }>;

    if (allDigests.length > 0) {
      // Sort by timestamp
      allDigests.sort((a, b) =>
        Number(a.timestampMs ?? 0) - Number(b.timestampMs ?? 0),
      );
      const first = allDigests[0];
      const last  = allDigests[allDigests.length - 1];
      if (first?.timestampMs) {
        activity.firstSeen = new Date(Number(first.timestampMs)).toISOString();
      }
      if (last?.timestampMs) {
        activity.lastActivity = new Date(Number(last.timestampMs)).toISOString();
      }
      activity.txCount = (toTxs?.data?.length ?? 0) + (fromTxs?.data?.length ?? 0);
    }

    // SUI balance
    const balance = await suiRpc('suix_getBalance', [address, '0x2::sui::SUI']) as {
      totalBalance: string;
    };
    const suiAmount = Number(balance.totalBalance) / MIST_PER_SUI;
    activity.ethBalance = suiAmount.toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' SUI';

    return { activity, errors };
  } catch (err) {
    errors.push('Sui activity unavailable');
    return { activity, errors };
  }
}

// ─── Known address registry ───────────────────────────────────────────────────

type EntityLabel = NonNullable<WalletCheckResult['entityLabel']>;

const KNOWN_ADDRESSES = new Map<string, EntityLabel>([
  // Binance
  ['0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be', { name: 'Binance', type: 'exchange', subLabel: 'Hot Wallet 1',  url: 'https://binance.com', confidence: 'definite' }],
  ['0xd551234ae421e3bcba99a0da6d736074f22192ff', { name: 'Binance', type: 'exchange', subLabel: 'Hot Wallet 2',  url: 'https://binance.com', confidence: 'definite' }],
  ['0x564286362092d8e7936f0549571a803b203aaced', { name: 'Binance', type: 'exchange', subLabel: 'Hot Wallet 3',  url: 'https://binance.com', confidence: 'definite' }],
  ['0x0681d8db095565fe8a346fa0277bffd65d716364', { name: 'Binance', type: 'exchange', subLabel: 'Hot Wallet 4',  url: 'https://binance.com', confidence: 'definite' }],
  ['0xfe9e8709d3215310075d67e3ed32a380ccf451c8', { name: 'Binance', type: 'exchange', subLabel: 'Hot Wallet 5',  url: 'https://binance.com', confidence: 'definite' }],
  ['0x4e9ce36e442e55ecd9025b9a6e0d88485d628a67', { name: 'Binance', type: 'exchange', subLabel: 'Hot Wallet 6',  url: 'https://binance.com', confidence: 'definite' }],
  ['0xbe0eb53f46cd790cd13851d5eff43d12404d33e8', { name: 'Binance', type: 'exchange', subLabel: 'Cold Wallet',   url: 'https://binance.com', confidence: 'definite' }],
  ['0xf977814e90da44bfa03b6295a0616a897441acec', { name: 'Binance', type: 'exchange', subLabel: 'Hot Wallet 8',  url: 'https://binance.com', confidence: 'definite' }],
  ['0x001866ae5b3de6caa5a51543fd9fb64f524f5478', { name: 'Binance', type: 'exchange', subLabel: 'Hot Wallet 9',  url: 'https://binance.com', confidence: 'definite' }],
  ['0x85b931a32a0725be14285b66f1a22178c672d69b', { name: 'Binance', type: 'exchange', subLabel: 'Hot Wallet 10', url: 'https://binance.com', confidence: 'definite' }],
  ['0x708396f17127c42383e3b9014072679b2f60b82',  { name: 'Binance', type: 'exchange', subLabel: 'Hot Wallet 11', url: 'https://binance.com', confidence: 'definite' }],

  // Coinbase
  ['0x71660c4005ba85c37ccec55d0c4493e66fe775d3', { name: 'Coinbase', type: 'exchange', subLabel: 'Hot Wallet 1', url: 'https://coinbase.com', confidence: 'definite' }],
  ['0x503828976d22510aad0201ac7ec88293211d23da', { name: 'Coinbase', type: 'exchange', subLabel: 'Hot Wallet 2', url: 'https://coinbase.com', confidence: 'definite' }],
  ['0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740', { name: 'Coinbase', type: 'exchange', subLabel: 'Hot Wallet 3', url: 'https://coinbase.com', confidence: 'definite' }],
  ['0x3cd751e6b0078be393132286c442345e5dc49699', { name: 'Coinbase', type: 'exchange', subLabel: 'Hot Wallet 4', url: 'https://coinbase.com', confidence: 'definite' }],
  ['0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511', { name: 'Coinbase', type: 'exchange', subLabel: 'Hot Wallet 5', url: 'https://coinbase.com', confidence: 'definite' }],
  ['0xeb2629a2734e272bcc07bda959863f316f4bd4cf', { name: 'Coinbase', type: 'exchange', subLabel: 'Hot Wallet 6', url: 'https://coinbase.com', confidence: 'definite' }],
  ['0xa090e606e30bd747d4e6245a1517ebe430f0057e', { name: 'Coinbase', type: 'exchange', subLabel: 'Hot Wallet 7', url: 'https://coinbase.com', confidence: 'definite' }],
  ['0xf6874c88b04d44c58c4a6ef5a6e45f0a96e95524', { name: 'Coinbase', type: 'exchange', subLabel: 'Hot Wallet 8', url: 'https://coinbase.com', confidence: 'definite' }],
  ['0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43', { name: 'Coinbase', type: 'exchange', subLabel: 'Prime',        url: 'https://coinbase.com', confidence: 'definite' }],

  // Kraken
  ['0xe853c56864a2ebe4576a807d26fdc4a0ada51919', { name: 'Kraken', type: 'exchange', subLabel: 'Hot Wallet 1', url: 'https://kraken.com', confidence: 'definite' }],
  ['0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0', { name: 'Kraken', type: 'exchange', subLabel: 'Hot Wallet 2', url: 'https://kraken.com', confidence: 'definite' }],
  ['0xfa52274dd61e1643d2205169732f29114bc240b3', { name: 'Kraken', type: 'exchange', subLabel: 'Hot Wallet 3', url: 'https://kraken.com', confidence: 'definite' }],
  ['0x53d284357ec70ce289d6d64134dfac8e511c8a3d', { name: 'Kraken', type: 'exchange', subLabel: 'Hot Wallet 4', url: 'https://kraken.com', confidence: 'definite' }],
  ['0x89e51fa8ca5d66cd220baed62ed01e8951aa7c40', { name: 'Kraken', type: 'exchange', subLabel: 'Hot Wallet 5', url: 'https://kraken.com', confidence: 'definite' }],

  // Gemini
  ['0xd24400ae8bfebb18ca49be86258a3c749cf46853', { name: 'Gemini', type: 'exchange', subLabel: 'Hot Wallet 1', url: 'https://gemini.com', confidence: 'definite' }],
  ['0x6fcd8a9b64fd0863e0c001d6e7f62e87b70a56b0', { name: 'Gemini', type: 'exchange', subLabel: 'Hot Wallet 2', url: 'https://gemini.com', confidence: 'definite' }],
  ['0x5f65f7b609678448494de4c87521cdf6cef1e932', { name: 'Gemini', type: 'exchange', subLabel: 'Hot Wallet 3', url: 'https://gemini.com', confidence: 'definite' }],

  // Bitfinex
  ['0x1151314c646ce4e0efd76d1af4760ae66a9fe30f', { name: 'Bitfinex', type: 'exchange', subLabel: 'Hot Wallet 1', url: 'https://bitfinex.com', confidence: 'definite' }],
  ['0x742d35cc6634c0532925a3b844bc454e4438f44e', { name: 'Bitfinex', type: 'exchange', subLabel: 'Hot Wallet 2', url: 'https://bitfinex.com', confidence: 'definite' }],
  ['0x876eabf441b2ee5b5b0554fd502a8e0600950cfa', { name: 'Bitfinex', type: 'exchange', subLabel: 'Hot Wallet 3', url: 'https://bitfinex.com', confidence: 'definite' }],

  // OKX
  ['0x6cc5f688a315f3dc28a7781717a9a798a59fda7b', { name: 'OKX', type: 'exchange', subLabel: 'Hot Wallet 1', url: 'https://okx.com', confidence: 'definite' }],
  ['0x236f9f97e0e62388479bf9e1b2c2d4e79a9c6c35', { name: 'OKX', type: 'exchange', subLabel: 'Hot Wallet 2', url: 'https://okx.com', confidence: 'definite' }],
  ['0xa7efae728d2936e78bda97dc267687568dd593f3', { name: 'OKX', type: 'exchange', subLabel: 'Hot Wallet 3', url: 'https://okx.com', confidence: 'definite' }],

  // Crypto.com
  ['0x6262998ced04146fa42253a5c0af90ca02dfd2a3', { name: 'Crypto.com', type: 'exchange', subLabel: 'Hot Wallet 1', url: 'https://crypto.com', confidence: 'definite' }],
  ['0x46340b20830761efd32832a74d7169b29feb9758', { name: 'Crypto.com', type: 'exchange', subLabel: 'Hot Wallet 2', url: 'https://crypto.com', confidence: 'definite' }],

  // Huobi / HTX
  ['0xab5c66752a9e8167967685f1450532fb96d5d24f', { name: 'Huobi', type: 'exchange', subLabel: 'Hot Wallet 1', url: 'https://htx.com', confidence: 'definite' }],
  ['0x6748f50f686bfbca6fe8ad62b22228b87f31ff2b', { name: 'Huobi', type: 'exchange', subLabel: 'Hot Wallet 2', url: 'https://htx.com', confidence: 'definite' }],
  ['0xfdb16996831753d5331ff813c29a93c76834a0ad', { name: 'Huobi', type: 'exchange', subLabel: 'Hot Wallet 3', url: 'https://htx.com', confidence: 'definite' }],

  // KuCoin
  ['0x2b5634c42055806a59e9107ed44d43c426e58258', { name: 'KuCoin', type: 'exchange', subLabel: 'Hot Wallet 1', url: 'https://kucoin.com', confidence: 'definite' }],
  ['0xa1d8d972560c2f8144af871db508f0b0b10a3fba', { name: 'KuCoin', type: 'exchange', subLabel: 'Hot Wallet 2', url: 'https://kucoin.com', confidence: 'definite' }],

  // Bybit
  ['0xf89d7b9c864f589bbf53a82105107622b35ea40',  { name: 'Bybit', type: 'exchange', subLabel: 'Hot Wallet 1', url: 'https://bybit.com', confidence: 'definite' }],
  ['0x1ab4973a48dc892cd9971ece8e01dcc7688f8f23', { name: 'Bybit', type: 'exchange', subLabel: 'Hot Wallet 2', url: 'https://bybit.com', confidence: 'definite' }],

  // FTX (defunct)
  ['0x2faf487a4414fe77e2327f0bf4ae2a264a776ad2', { name: 'FTX (Defunct)', type: 'exchange', subLabel: 'Hot Wallet 1', url: null, confidence: 'definite' }],
  ['0xc098b2a3aa256d2140208c3de6543aaef5cd3a94', { name: 'FTX (Defunct)', type: 'exchange', subLabel: 'Hot Wallet 2', url: null, confidence: 'definite' }],

  // Uniswap V3
  ['0x1f98431c8ad98523631ae4a59f267346ea31f984', { name: 'Uniswap V3', type: 'defi', subLabel: 'Factory',  url: 'https://uniswap.org', confidence: 'definite' }],
  ['0xe592427a0aece92de3edee1f18e0157c05861564', { name: 'Uniswap V3', type: 'defi', subLabel: 'Router',   url: 'https://uniswap.org', confidence: 'definite' }],
  ['0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', { name: 'Uniswap V3', type: 'defi', subLabel: 'Router 2', url: 'https://uniswap.org', confidence: 'definite' }],

  // Aave
  ['0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9', { name: 'Aave V2', type: 'defi', subLabel: 'Lending Pool', url: 'https://aave.com', confidence: 'definite' }],
  ['0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', { name: 'Aave V3', type: 'defi', subLabel: 'Pool',         url: 'https://aave.com', confidence: 'definite' }],

  // ── Wormhole (EVM) ────────────────────────────────────────────────────────
  ['0x3ee18b2214aff97000d974cf647e7c347e8fa585', { name: 'Wormhole', type: 'bridge', subLabel: 'Token Bridge (ETH)',  url: 'https://wormhole.com', confidence: 'definite' }],
  ['0x98f3c9e6e3face36baad05fe09d375ef1464288b', { name: 'Wormhole', type: 'bridge', subLabel: 'Core Bridge (ETH)',   url: 'https://wormhole.com', confidence: 'definite' }],
  ['0x6ffd7ede62328b3af38fcd61461bbfc52f5651fe', { name: 'Wormhole', type: 'bridge', subLabel: 'NFT Bridge (ETH)',    url: 'https://wormhole.com', confidence: 'definite' }],
  ['0x27428dd2d3dd32a4d7f7c497eaaa23130d894911', { name: 'Wormhole', type: 'bridge', subLabel: 'Relayer (ETH)',       url: 'https://wormhole.com', confidence: 'definite' }],
  ['0x706f82e9bb5b0813501714ab5974216704980e31', { name: 'Wormhole', type: 'bridge', subLabel: 'CCTP Relayer (ETH)',  url: 'https://wormhole.com', confidence: 'definite' }],

  // ── Wormhole (Sui) ────────────────────────────────────────────────────────
  ['0xaeab97f96cf9877fee2883315d459552b2b921edc16d7ceac6eab944dd88919c', { name: 'Wormhole', type: 'bridge', subLabel: 'Core Bridge (Sui)',  url: 'https://wormhole.com', confidence: 'definite' }],
  ['0x26efee2b51c911237888e5dc6702868abca3c7ac12c53f76ef8eba0697695e3d', { name: 'Wormhole', type: 'bridge', subLabel: 'Token Bridge (Sui)', url: 'https://wormhole.com', confidence: 'definite' }],

  // ── Stargate / LayerZero ──────────────────────────────────────────────────
  ['0x8731d54e9d02c286767d56ac03e8037c07e01e98', { name: 'Stargate', type: 'bridge', subLabel: 'Router',      url: 'https://stargate.finance', confidence: 'definite' }],
  ['0xdf0770df86a8034b3efef0a1bb3c889b8332ff56', { name: 'Stargate', type: 'bridge', subLabel: 'USDC Pool',   url: 'https://stargate.finance', confidence: 'definite' }],
  ['0x38ea452219524bb87e18de1c24d3bb59510bd783', { name: 'Stargate', type: 'bridge', subLabel: 'USDT Pool',   url: 'https://stargate.finance', confidence: 'definite' }],
  ['0x101816545f6bd2b1076434b54383a1e633390a2e', { name: 'Stargate', type: 'bridge', subLabel: 'ETH Pool',    url: 'https://stargate.finance', confidence: 'definite' }],

  // ── Celer cBridge ─────────────────────────────────────────────────────────
  ['0x5427fefa711eff984124bfbb1ab6fbf5e3da1820', { name: 'Celer cBridge', type: 'bridge', subLabel: 'v2',  url: 'https://cbridge.celer.network', confidence: 'definite' }],
  ['0x1619de6b6b20ed217a58d00f37b9d47c7663feca', { name: 'Celer cBridge', type: 'bridge', subLabel: 'v1',  url: 'https://cbridge.celer.network', confidence: 'definite' }],

  // ── Hop Protocol ──────────────────────────────────────────────────────────
  ['0xb8901acb165ed027e32754e0ffe830802919727f', { name: 'Hop Protocol', type: 'bridge', subLabel: 'USDC Bridge', url: 'https://hop.exchange', confidence: 'definite' }],
  ['0x3666f603cc164936c1b87e207f36beba4ac5f18a', { name: 'Hop Protocol', type: 'bridge', subLabel: 'USDT Bridge', url: 'https://hop.exchange', confidence: 'definite' }],
  ['0xb98454270065a31d71bf635f6f7ee6a518dfb849', { name: 'Hop Protocol', type: 'bridge', subLabel: 'ETH Bridge',  url: 'https://hop.exchange', confidence: 'definite' }],

  // ── Across Protocol ───────────────────────────────────────────────────────
  ['0x4d9079bb4165aeb4084c526a32695dcfd2f77381', { name: 'Across Protocol', type: 'bridge', subLabel: 'Spoke Pool', url: 'https://across.to', confidence: 'definite' }],
  ['0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5', { name: 'Across Protocol', type: 'bridge', subLabel: 'Spoke Pool v2', url: 'https://across.to', confidence: 'definite' }],

  // ── Synapse Protocol ──────────────────────────────────────────────────────
  ['0x2796317b0ff8538f253012862c06787adfb8ceb6', { name: 'Synapse Protocol', type: 'bridge', subLabel: 'Bridge',  url: 'https://synapseprotocol.com', confidence: 'definite' }],

  // ── Connext ───────────────────────────────────────────────────────────────
  ['0x8898b472c54c31894e3b9bb83cea802a5d0e63c6', { name: 'Connext', type: 'bridge', subLabel: 'Diamond',  url: 'https://connext.network', confidence: 'definite' }],

  // ── Arbitrum Bridge ───────────────────────────────────────────────────────
  ['0x72ce9c846789fdb6fc1f34ac4ad25dd9ef7031ef', { name: 'Arbitrum Bridge', type: 'bridge', subLabel: 'L1 Gateway Router', url: 'https://bridge.arbitrum.io', confidence: 'definite' }],
  ['0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a', { name: 'Arbitrum Bridge', type: 'bridge', subLabel: 'Inbox',             url: 'https://bridge.arbitrum.io', confidence: 'definite' }],

  // ── Polygon Bridge ────────────────────────────────────────────────────────
  ['0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf', { name: 'Polygon Bridge', type: 'bridge', subLabel: 'ERC20 Bridge', url: 'https://wallet.polygon.technology/bridge', confidence: 'definite' }],
  ['0xa0c68c638235ee32657e8f720a23cec1bfc77c77', { name: 'Polygon Bridge', type: 'bridge', subLabel: 'Plasma Bridge', url: 'https://wallet.polygon.technology/bridge', confidence: 'definite' }],

  // ── Optimism Bridge ───────────────────────────────────────────────────────
  ['0x99c9fc46f92e8a1c0dec1b1747d010903e884be1', { name: 'Optimism Bridge', type: 'bridge', subLabel: 'L1 Standard Bridge', url: 'https://app.optimism.io/bridge', confidence: 'definite' }],
  ['0xbeb5fc579115071764c7423a4f12edde41f106ed', { name: 'Optimism Bridge', type: 'bridge', subLabel: 'Portal',             url: 'https://app.optimism.io/bridge', confidence: 'definite' }],

  // ── Base Bridge ───────────────────────────────────────────────────────────
  ['0x3154cf16ccdb4c6d922629664174b904d80f2c35', { name: 'Base Bridge', type: 'bridge', subLabel: 'L1 Standard Bridge', url: 'https://bridge.base.org', confidence: 'definite' }],
  ['0x49048044d57e1c92a77f79988d21fa8faf74e97e', { name: 'Base Bridge', type: 'bridge', subLabel: 'Portal',             url: 'https://bridge.base.org', confidence: 'definite' }],

  // ── Multichain (compromised/defunct — warn users) ─────────────────────────
  ['0x765277eebeca2e31912c9946eae1021199b39c61', { name: 'Multichain (Compromised)', type: 'bridge', subLabel: 'Do not use — exploited 2023', url: null, confidence: 'definite' }],
  ['0x4f3aff3a747fcade12598081e80c6605a8be192f', { name: 'Multichain (Compromised)', type: 'bridge', subLabel: 'Do not use — exploited 2023', url: null, confidence: 'definite' }],
]);

async function fetchEntityLabel(address: string): Promise<WalletCheckResult['entityLabel']> {
  // 1. Check hardcoded lookup first (instant, no API)
  const known = KNOWN_ADDRESSES.get(address.toLowerCase());
  if (known) return known;

  // 2. For EVM only: check Etherscan for verified contract name
  if (detectChain(address) === 'evm') {
    try {
      const apiKey = import.meta.env.ETHERSCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY ?? '';
      if (apiKey) {
        const res = await fetchWithTimeout(
          `https://api.etherscan.io/v2/api?chainid=1&apikey=${apiKey}&module=contract&action=getsourcecode&address=${address}`,
        );
        if (res.ok) {
          const json = await res.json() as any;
          const contractName = json?.result?.[0]?.ContractName;
          if (contractName && contractName !== '') {
            return {
              name: contractName,
              type: 'contract',
              subLabel: 'Verified Contract',
              url: `https://etherscan.io/address/${address}`,
              confidence: 'definite',
            };
          }
        }
      }
    } catch { /* ignore */ }
  }

  return null;
}

// ─── ENS reverse lookup ───────────────────────────────────────────────────────
// Uses ENS ReverseRecords contract via Alchemy eth_call — no extra API key needed.
// Contract 0x3671aE578E63FdF66ad4F3E12CC0c0d71Ac7510C · getNames(address[])
// Selector 0x3a0c74c8 (keccak256("getNames(address[])")[0..3])

async function fetchENSName(address: string): Promise<string | null> {
  if (detectChain(address) !== 'evm') return null;
  const apiKey = process.env.ALCHEMY_API_KEY ?? import.meta.env.ALCHEMY_API_KEY ?? '';
  if (!apiKey) return null;

  try {
    const REVERSE_RECORDS = '0x3671aE578E63FdF66ad4F3E12CC0c0d71Ac7510C';
    const addr = address.toLowerCase().slice(2).padStart(64, '0');
    // ABI-encode: getNames(address[]) with one element
    const calldata =
      '0x3a0c74c8' +
      '0000000000000000000000000000000000000000000000000000000000000020' + // offset
      '0000000000000000000000000000000000000000000000000000000000000001' + // length = 1
      addr;                                                                 // address

    const res = await fetchWithTimeout(
      `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'eth_call',
          params: [{ to: REVERSE_RECORDS, data: calldata }, 'latest'],
        }),
      },
    );

    if (!res.ok) return null;
    const json = await res.json() as any;
    const hex: string = json?.result;
    if (!hex || hex === '0x' || hex.length < 258) return null;

    // ABI decode string[]:
    // hex[0..63]    outer offset (0x20)
    // hex[64..127]  array length (1)
    // hex[128..191] string[0] offset (0x20)
    // hex[192..255] string[0] byte length
    // hex[256..]    string bytes
    const data = hex.slice(2); // strip 0x
    const strLen = parseInt(data.slice(192, 256), 16);
    if (!strLen || strLen > 200) return null;

    const strHex = data.slice(256, 256 + strLen * 2);
    const name = Buffer.from(strHex, 'hex').toString('utf8').trim();
    return name && name.includes('.') ? name : null;
  } catch {
    return null;
  }
}

// ─── TronGrid — wallet age, tx count, TRX balance, TRC-20 holdings ───────────
// Public API, no key required. https://developers.tron.network/

const TRONGRID_BASE = 'https://api.trongrid.io';
const SUN_PER_TRX   = 1_000_000;

async function fetchTronActivity(
  address: string,
): Promise<{ activity: WalletCheckResult['activity']; errors: string[] }> {
  const errors: string[] = [];
  const activity: WalletCheckResult['activity'] = {
    firstSeen: null, lastActivity: null, txCount: null,
    totalReceivedEth: null, totalSentEth: null, ethBalance: null,
  };
  try {
    const res = await fetchWithTimeout(`${TRONGRID_BASE}/v1/accounts/${encodeURIComponent(address)}`);
    if (!res.ok) { errors.push(`TronGrid returned ${res.status}`); return { activity, errors }; }
    const json = await res.json() as any;
    const acct = json?.data?.[0];
    if (!acct) return { activity, errors }; // address exists but has no on-chain history yet

    // create_time is epoch ms
    if (acct.create_time) {
      const d = new Date(acct.create_time);
      activity.firstSeen    = d.toISOString().slice(0, 10);
      activity.lastActivity = activity.firstSeen; // best available without tx pagination
    }
    // latest_opration_time (sic) is also epoch ms
    if (acct.latest_opration_time) {
      activity.lastActivity = new Date(acct.latest_opration_time).toISOString().slice(0, 10);
    }
    // TRX balance in sun (1 TRX = 1,000,000 sun) — store in ethBalance field (repurposed as native balance)
    if (typeof acct.balance === 'number') {
      activity.ethBalance = String((acct.balance / SUN_PER_TRX).toFixed(4));
    }
  } catch {
    errors.push('TronGrid unavailable');
  }
  return { activity, errors };
}

async function fetchTronHoldings(
  address: string,
): Promise<{ holdings: WalletCheckResult['holdings']; errors: string[] }> {
  const errors: string[] = [];
  const holdings: WalletCheckResult['holdings'] = [];
  try {
    // TRC-20 token balances
    const res = await fetchWithTimeout(
      `${TRONGRID_BASE}/v1/accounts/${encodeURIComponent(address)}/tokens?token_id=_&limit=20`,
    );
    if (!res.ok) { errors.push(`TronGrid tokens returned ${res.status}`); return { holdings, errors }; }
    const json = await res.json() as any;
    const tokens: any[] = json?.data ?? [];

    // Fetch TRX price once for USD conversion
    let trxPriceUsd: number | null = null;
    try {
      const p = await fetchWithTimeout(
        'https://api.coingecko.com/api/v3/simple/price?ids=tron&vs_currencies=usd',
      );
      if (p.ok) trxPriceUsd = ((await p.json()) as any)?.tron?.usd ?? null;
    } catch { /* price optional */ }

    // Also grab TRX balance from account endpoint for the native token row
    try {
      const acctRes = await fetchWithTimeout(`${TRONGRID_BASE}/v1/accounts/${encodeURIComponent(address)}`);
      if (acctRes.ok) {
        const acctJson = await acctRes.json() as any;
        const trxSun = acctJson?.data?.[0]?.balance;
        if (typeof trxSun === 'number' && trxSun > 0) {
          const trxAmount = (trxSun / SUN_PER_TRX).toFixed(4);
          holdings.push({
            symbol: 'TRX',
            name: 'TRON',
            balance: trxAmount,
            usdValue: trxPriceUsd ? Number((Number(trxAmount) * trxPriceUsd).toFixed(2)) : null,
          });
        }
      }
    } catch { /* skip native row */ }

    for (const t of tokens.slice(0, 12)) {
      try {
        const decimals = Number(t.tokenDecimal ?? t.precision ?? 6);
        const rawBal   = BigInt(String(t.balance ?? '0'));
        const amount   = (Number(rawBal) / Math.pow(10, decimals)).toFixed(4);
        if (Number(amount) === 0) continue;
        holdings.push({
          symbol:   String(t.tokenAbbr  ?? t.symbol ?? '???').slice(0, 12),
          name:     String(t.tokenName  ?? t.name   ?? 'Unknown').slice(0, 40),
          balance:  amount,
          usdValue: null,
        });
      } catch { /* skip */ }
    }
  } catch {
    errors.push('TronGrid holdings unavailable');
  }
  return { holdings, errors };
}

// ─── Chainabuse community reports ─────────────────────────────────────────────
// Free tier available — set CHAINABUSE_API_KEY env var to enable.
// https://www.chainabuse.com/

async function fetchChainavuseReports(address: string): Promise<{ count: number | null; errors: string[] }> {
  const apiKey = process.env.CHAINABUSE_API_KEY ?? import.meta.env.CHAINABUSE_API_KEY ?? '';
  if (!apiKey) return { count: null, errors: [] }; // not configured — skip silently

  const chain = detectChain(address);
  const network =
    chain === 'evm'      ? 'ethereum' :
    chain === 'solana'   ? 'solana' :
    chain === 'bitcoin'  ? 'bitcoin' :
    chain === 'litecoin' ? 'litecoin' :
    chain === 'tron'     ? 'tron' : null;
  if (!network) return { count: null, errors: [] };

  try {
    const res = await fetchWithTimeout(
      `https://api.chainabuse.com/v0/reports?address=${encodeURIComponent(address)}&network=${network}`,
      { headers: { 'X-API-KEY': apiKey } },
    );
    if (!res.ok) return { count: null, errors: [`Chainabuse returned ${res.status}`] };
    const json = await res.json() as any;
    const count = Array.isArray(json?.reports) ? json.reports.length : (json?.total ?? null);
    return { count: typeof count === 'number' ? count : null, errors: [] };
  } catch {
    return { count: null, errors: ['Chainabuse unavailable'] };
  }
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function checkWallet(address: string): Promise<WalletCheckResult> {
  const chain = detectChain(address);
  const allErrors: string[] = [];

  // Recognised chain but no safety data yet — return a stub result immediately
  if (!SUPPORTED_CHAINS.has(chain) && chain !== 'unknown') {
    const emptyF: WalletCheckResult['flags'] = {
      blacklisted: false, phishing: false, honeypotRelated: false,
      stealingAttack: false, darkwebTransactions: false, cybercrime: false,
      moneyLaundering: false, financialCrime: false, blackmail: false,
      mixer: false, sanctioned: false,
    };
    return {
      address,
      chain,
      checkedAt: new Date().toISOString(),
      scamScore: 0,
      scamLevel: 'caution',
      flags: emptyF,
      ensName: null,
      chainabuseReports: null,
      multiSig: null,
      holdings: [],
      activity: { firstSeen: null, lastActivity: null, txCount: null, totalReceivedEth: null, totalSentEth: null, ethBalance: null },
      honeypot: { checked: false, isHoneypot: null, reason: null },
      fundingSource: { fromMixer: null, fromExchange: null, label: null },
      entityLabel: null,
      errors: [],
      coverage: { goplus: 'skipped', honeypot: 'skipped', chainabuse: 'skipped' },
      partialCoverage: true,
    };
  }

  const emptyFlags: WalletCheckResult['flags'] = {
    blacklisted: false, phishing: false, honeypotRelated: false,
    stealingAttack: false, darkwebTransactions: false, cybercrime: false,
    moneyLaundering: false, financialCrime: false, blackmail: false,
    mixer: false, sanctioned: false,
  };

  const noActivity = { firstSeen: null, lastActivity: null, txCount: null, totalReceivedEth: null, totalSentEth: null, ethBalance: null };

  // Run all fetchers in parallel — each is independently fault-tolerant
  const [goplusResult, activityResult, holdingsResult, honeypotResult, multiSigResult, entityLabelResult, ensResult, chainabuseResult] =
    await Promise.allSettled([
      fetchGoPlusFlags(address),
      chain === 'evm'    ? fetchEtherscanActivity(address)
        : chain === 'sui'  ? fetchSuiActivity(address)
        : chain === 'tron' ? fetchTronActivity(address)
        : Promise.resolve({ activity: noActivity, errors: [`Activity tracking not available for ${chain}`] }),
      chain === 'evm'    ? fetchTokenBalances(address)
        : chain === 'sui'  ? fetchSuiHoldings(address)
        : chain === 'tron' ? fetchTronHoldings(address)
        : Promise.resolve({ holdings: [], errors: [`Token balances not available for ${chain}`] }),
      chain === 'evm' ? fetchHoneypotCheck(address) : Promise.resolve({ honeypot: { checked: false, isHoneypot: null, reason: `EVM only` as string | null }, errors: [] }),
      chain === 'evm' ? fetchMultiSigCheck(address) : Promise.resolve({ multiSig: null, errors: [] }),
      fetchEntityLabel(address),
      fetchENSName(address),
      fetchChainavuseReports(address),
    ]);

  const goplus       = goplusResult.status       === 'fulfilled' ? goplusResult.value       : { flags: {}, errors: ['GoPlus check failed'] };
  const activity     = activityResult.status     === 'fulfilled' ? activityResult.value     : { activity: noActivity, errors: ['Activity check failed'] };
  const holdings     = holdingsResult.status     === 'fulfilled' ? holdingsResult.value     : { holdings: [], errors: ['Holdings check failed'] };
  const honeypot     = honeypotResult.status     === 'fulfilled' ? honeypotResult.value     : { honeypot: { checked: false, isHoneypot: null, reason: null }, errors: ['Honeypot check failed'] };
  const multiSig     = multiSigResult.status     === 'fulfilled' ? multiSigResult.value     : { multiSig: null, errors: [] };
  const entityLabel  = entityLabelResult.status  === 'fulfilled' ? entityLabelResult.value  : null;
  const ensName      = ensResult.status          === 'fulfilled' ? ensResult.value          : null;
  const chainabuse   = chainabuseResult.status   === 'fulfilled' ? chainabuseResult.value   : { count: null, errors: [] };

  allErrors.push(
    ...(goplus.errors    ?? []),
    ...(activity.errors  ?? []),
    ...(holdings.errors  ?? []),
    ...(honeypot.errors  ?? []),
    ...(multiSig.errors  ?? []),
    ...(chainabuse.errors ?? []),
  );

  const flags: WalletCheckResult['flags'] = { ...emptyFlags, ...(goplus.flags ?? {}) };
  const { score, level } = calculateScamScore(flags);

  // ── Coverage: did the PRIMARY scam source run for this chain? ──────────────────
  // GoPlus (blacklist/sanctions/phishing) is the primary source and covers EVM +
  // Solana only; honeypot.is is EVM-only; Chainabuse is community/secondary. A
  // "clean" verdict where the primary source could not run must NOT be shown as a
  // confident green (P0/P1 hardening).
  const goplusSupported   = chain === 'evm' || chain === 'solana' || chain === 'tron';
  const goplusErrored     = goplusResult.status     === 'rejected' || (goplus.errors     ?? []).some((e: string) => e.includes('GoPlus'));
  const honeypotErrored   = honeypotResult.status   === 'rejected' || (honeypot.errors   ?? []).some((e: string) => e.includes('Honeypot'));
  const chainabuseErrored = chainabuseResult.status === 'rejected' || (chainabuse.errors ?? []).length > 0;
  const coverage: WalletCheckResult['coverage'] = {
    goplus:     !goplusSupported ? 'skipped' : goplusErrored ? 'error' : 'ran',
    honeypot:   chain === 'evm' ? (honeypotErrored ? 'error' : 'ran') : 'skipped',
    chainabuse: chainabuseErrored ? 'error' : 'ran',
  };
  // Partial when no primary scam source ran: non-EVM/Solana chains have none at all;
  // EVM/Solana are partial only if GoPlus itself didn't run.
  const partialCoverage = goplusSupported ? coverage.goplus !== 'ran' : true;

  // Funding source: infer from GoPlus mixer flag for now
  const fundingSource: WalletCheckResult['fundingSource'] = {
    fromMixer:    flags.mixer ? true : null,
    fromExchange: null,
    label:        flags.mixer ? 'Mixer / Tornado Cash activity detected' : null,
  };

  return {
    address,
    chain,
    checkedAt: new Date().toISOString(),
    scamScore: score,
    scamLevel: level,
    flags,
    ensName,
    chainabuseReports: chainabuse.count,
    multiSig:      multiSig.multiSig,
    holdings:      holdings.holdings,
    activity:      activity.activity,
    honeypot:      honeypot.honeypot,
    fundingSource,
    entityLabel,
    errors: allErrors,
    coverage,
    partialCoverage,
  };
}
