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

const EVM_REGEX = /^0x[0-9a-fA-F]{40}$/;
const SUI_REGEX = /^0x[0-9a-fA-F]{64}$/;
const SOLANA_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type Chain = 'evm' | 'sui' | 'solana' | 'unknown';

export function detectChain(address: string): Chain {
  if (SUI_REGEX.test(address)) return 'sui';   // check before EVM (both start with 0x)
  if (EVM_REGEX.test(address)) return 'evm';
  if (SOLANA_REGEX.test(address)) return 'solana';
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
  multiSig: boolean | null;
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
  errors: string[];
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

// GoPlus chain_id map — Sui not supported by GoPlus address_security endpoint
const GOPLUS_CHAIN_ID: Record<Chain, string | null> = {
  evm:     '1',   // Ethereum mainnet
  solana:  'solana',
  sui:     null,  // GoPlus does not support Sui address security
  unknown: null,
};

// GoPlus Security — free, no API key needed
// https://gopluslabs.io/
async function fetchGoPlusFlags(
  address: string,
): Promise<{ flags: Partial<WalletCheckResult['flags']>; errors: string[] }> {
  const errors: string[] = [];
  const flags: Partial<WalletCheckResult['flags']> = {};
  const chainId = GOPLUS_CHAIN_ID[detectChain(address)];
  if (!chainId) return { flags, errors }; // chain not supported — skip silently
  try {
    const res = await fetchWithTimeout(
      `https://api.gopluslabs.io/api/v1/address_security/${encodeURIComponent(address)}?chain_id=${chainId}`,
    );
    if (!res.ok) {
      errors.push(`GoPlus returned ${res.status}`);
      return { flags, errors };
    }
    const json = await res.json() as Record<string, any>;
    const d = json?.result ?? {};
    const flag = (v: unknown) => String(v) === '1';
    flags.blacklisted         = flag(d.blacklist_doubt);
    flags.phishing            = flag(d.phishing_activities);
    flags.honeypotRelated     = flag(d.honeypot_related_address);
    flags.stealingAttack      = flag(d.stealing_attack);
    flags.darkwebTransactions = flag(d.darkweb_transactions);
    flags.cybercrime          = flag(d.cybercrime);
    flags.moneyLaundering     = flag(d.money_laundering);
    flags.financialCrime      = flag(d.financial_crime);
    flags.blackmail           = flag(d.blackmail_activities);
    flags.mixer               = flag(d.mixer);
    flags.sanctioned          = flag(d.sanctioned);
  } catch (err) {
    errors.push('GoPlus unavailable');
  }
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

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function checkWallet(address: string): Promise<WalletCheckResult> {
  const chain = detectChain(address);
  const allErrors: string[] = [];

  const emptyFlags: WalletCheckResult['flags'] = {
    blacklisted: false, phishing: false, honeypotRelated: false,
    stealingAttack: false, darkwebTransactions: false, cybercrime: false,
    moneyLaundering: false, financialCrime: false, blackmail: false,
    mixer: false, sanctioned: false,
  };

  // Run all fetchers in parallel — each is independently fault-tolerant
  const [goplusResult, activityResult, holdingsResult, honeypotResult, multiSigResult] =
    await Promise.allSettled([
      fetchGoPlusFlags(address),
      chain === 'evm' ? fetchEtherscanActivity(address) : Promise.resolve({ activity: { firstSeen: null, lastActivity: null, txCount: null, totalReceivedEth: null, totalSentEth: null, ethBalance: null }, errors: ['Activity tracking only available for EVM addresses'] }),
      chain === 'evm' ? fetchTokenBalances(address)    : Promise.resolve({ holdings: [], errors: ['Token balances only available for EVM addresses'] }),
      chain === 'evm' ? fetchHoneypotCheck(address)    : Promise.resolve({ honeypot: { checked: false, isHoneypot: null, reason: 'EVM only' }, errors: [] }),
      chain === 'evm' ? fetchMultiSigCheck(address)    : Promise.resolve({ multiSig: null, errors: [] }),
    ]);

  const goplus   = goplusResult.status   === 'fulfilled' ? goplusResult.value   : { flags: {}, errors: ['GoPlus check failed'] };
  const activity = activityResult.status === 'fulfilled' ? activityResult.value : { activity: { firstSeen: null, lastActivity: null, txCount: null, totalReceivedEth: null, totalSentEth: null, ethBalance: null }, errors: ['Activity check failed'] };
  const holdings = holdingsResult.status === 'fulfilled' ? holdingsResult.value : { holdings: [], errors: ['Holdings check failed'] };
  const honeypot = honeypotResult.status === 'fulfilled' ? honeypotResult.value : { honeypot: { checked: false, isHoneypot: null, reason: null }, errors: ['Honeypot check failed'] };
  const multiSig = multiSigResult.status === 'fulfilled' ? multiSigResult.value : { multiSig: null, errors: [] };

  allErrors.push(
    ...(goplus.errors ?? []),
    ...(activity.errors ?? []),
    ...(holdings.errors ?? []),
    ...(honeypot.errors ?? []),
    ...(multiSig.errors ?? []),
  );

  const flags: WalletCheckResult['flags'] = { ...emptyFlags, ...(goplus.flags ?? {}) };
  const { score, level } = calculateScamScore(flags);

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
    multiSig:      multiSig.multiSig,
    holdings:      holdings.holdings,
    activity:      activity.activity,
    honeypot:      honeypot.honeypot,
    fundingSource,
    errors: allErrors,
  };
}
